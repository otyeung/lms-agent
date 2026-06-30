import {
  ALLOWED_SQL_COLUMNS_BY_TABLE,
  ALLOWED_SQL_TABLE_NAMES,
  getSqlSchemaDescription,
} from './sql-schema.js'

export type TextToSqlIntent =
  | 'campaign_count'
  | 'highest_budget_campaign'
  | 'leads_by_job_title'
  | 'campaign_list'

export interface TextToSqlSuccess {
  status: 'success'
  question: string
  intent: TextToSqlIntent
  sql: string
  parameters: unknown[]
  explanation: string
  schemaDescription: string
}

export interface TextToSqlUnsupported {
  status: 'unsupported'
  question: string
  message: string
  supportedExamples: string[]
  schemaDescription: string
}

export interface TextToSqlUnsafe {
  status: 'unsafe'
  question: string
  message: string
  schemaDescription: string
}

export type TextToSqlResult =
  | TextToSqlSuccess
  | TextToSqlUnsupported
  | TextToSqlUnsafe

export interface SqlValidationValid {
  status: 'valid'
}

export interface SqlValidationInvalid {
  status: 'invalid'
  reason: string
}

export type SqlValidationResult = SqlValidationValid | SqlValidationInvalid

const SUPPORTED_EXAMPLES = [
  'How many active campaigns do we currently have running?',
  'Which campaign has the highest allocated budget?',
  'Which campaigns generated leads with the \'Director of IT\' job title, and what are their company names?',
  'list all campaigns from 1st to 200th record',
] as const

const DISALLOWED_SQL_PATTERN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|call|execute|merge|into|lock)\b/i

const SQL_BY_INTENT: Record<TextToSqlIntent, string> = {
  campaign_count: `SELECT COUNT(*) AS active_campaigns FROM public.campaign WHERE status = 'ACTIVE'`,
  highest_budget_campaign: `SELECT id, name, budget FROM public.campaign WHERE budget = (SELECT MAX(budget) FROM public.campaign) ORDER BY id`,
  leads_by_job_title: `SELECT c.name AS campaign_name, l.job_title, l.company_name, clm.cost_per_lead FROM public.campaign AS c JOIN public.campaign_lead_map AS clm ON clm.campaign_id = c.id JOIN public.lead_event AS l ON l.id = clm.lead_event_id WHERE l.job_title ILIKE $1 ORDER BY clm.cost_per_lead ASC`,
  campaign_list: `SELECT id, name, objective, budget, status FROM public.campaign ORDER BY id LIMIT 200`,
}

export function translateQuestionToSql(question: string): TextToSqlResult {
  const trimmedQuestion = question.trim()
  const normalizedQuestion = normalizeQuestion(trimmedQuestion)
  const schemaDescription = getSqlSchemaDescription()

  if (!trimmedQuestion) {
    return unsupported(trimmedQuestion, 'Ask a LinkedIn Ads campaign or lead database question.')
  }

  const writeIntent = /\b(delete|remove|drop|update|insert|create|truncate|change)\b/i
  if (writeIntent.test(trimmedQuestion)) {
    return {
      status: 'unsupported',
      question: trimmedQuestion,
      message: 'Only read-only LinkedIn Ads campaign SELECT questions are supported.',
      supportedExamples: [...SUPPORTED_EXAMPLES],
      schemaDescription,
    }
  }

  if (
    normalizedQuestion.includes('how many active campaigns') ||
    normalizedQuestion.includes('number of active campaigns') ||
    normalizedQuestion.includes('active campaign count') ||
    normalizedQuestion.includes('campaigns currently running')
  ) {
    return success(trimmedQuestion, 'campaign_count', [])
  }

  if (
    normalizedQuestion.includes('highest budget') ||
    normalizedQuestion.includes('highest allocated budget') ||
    normalizedQuestion.includes('largest budget') ||
    normalizedQuestion.includes('max budget')
  ) {
    return success(trimmedQuestion, 'highest_budget_campaign', [])
  }

  if (
    normalizedQuestion.includes('lead') &&
    normalizedQuestion.includes('job title')
  ) {
    const jobTitle = extractJobTitle(trimmedQuestion)

    if (!jobTitle) {
      return unsupported(
        trimmedQuestion,
        'Provide a job title value, for example Director of IT.',
      )
    }

    return success(trimmedQuestion, 'leads_by_job_title', [`%${jobTitle}%`])
  }

  if (
    (normalizedQuestion.includes('list all campaigns') ||
      normalizedQuestion.includes('show all campaigns') ||
      normalizedQuestion.includes('all campaign records')) &&
    (normalizedQuestion.includes('1st') ||
      normalizedQuestion.includes('first') ||
      normalizedQuestion.includes('200th') ||
      normalizedQuestion.includes('200'))
  ) {
    return success(trimmedQuestion, 'campaign_list', [])
  }

  return unsupported(
    trimmedQuestion,
    'This question is outside the configured LinkedIn Ads campaign Text-to-SQL examples.',
  )
}

export function validateReadOnlySql(sql: string): SqlValidationResult {
  const trimmedSql = sql.trim()
  const loweredSql = trimmedSql.toLowerCase()

  if (!trimmedSql) {
    return { status: 'invalid', reason: 'SQL is empty.' }
  }

  if (!/^select\b/i.test(trimmedSql)) {
    return { status: 'invalid', reason: 'Only SELECT queries are allowed.' }
  }

  if (/^with\b/i.test(trimmedSql)) {
    return { status: 'invalid', reason: 'WITH queries are not supported in this Text-to-SQL implementation.' }
  }

  if (trimmedSql.includes(';')) {
    return { status: 'invalid', reason: 'Multiple SQL statements are not allowed.' }
  }

  if (DISALLOWED_SQL_PATTERN.test(loweredSql)) {
    return { status: 'invalid', reason: 'SQL contains a disallowed keyword.' }
  }

  const tables = extractReferencedTables(loweredSql)
  
  // Reject SELECT queries without a FROM clause that reference tables
  if (!/\bfrom\b/i.test(loweredSql) && !/\bjoin\b/i.test(loweredSql)) {
    // If no FROM or JOIN, must be an aggregate-only query like SELECT COUNT(*)
    const selectClause = loweredSql.match(/^select\s+(.*?)(?:\s+where|\s+group|\s+order|\s+limit|$)/i)
    if (selectClause && !selectClause[1].match(/^\s*count\s*\(\s*\*\s*\)\s*(?:as\s+\w+)?\s*$/i)) {
      // Not a simple COUNT(*), likely trying to access functions or data without FROM
      return { status: 'invalid', reason: 'SELECT queries must reference at least one allowlisted table via FROM or JOIN clause.' }
    }
  }

  for (const tableName of tables) {
    if (!ALLOWED_SQL_TABLE_NAMES.has(tableName)) {
      return {
        status: 'invalid',
        reason: `Table ${tableName} is not in the Text-to-SQL allowlist.`,
      }
    }
  }

  // Validate aliased column references
  for (const { alias, column } of extractAliasColumns(trimmedSql)) {
    const tableName = resolveAlias(alias, loweredSql)
    const allowedColumns = tableName
      ? ALLOWED_SQL_COLUMNS_BY_TABLE.get(tableName)
      : undefined

    if (!allowedColumns?.has(column)) {
      return {
        status: 'invalid',
        reason: `Column reference ${alias}.${column} is not allowlisted.`,
      }
    }
  }

  // Validate unaliased column references
  const unaliasedColumns = extractUnaliasedColumns(trimmedSql)
  if (unaliasedColumns.length > 0) {
    const distinctTables = [...new Set(tables)]
    
    // Reject unaliased columns when multiple tables are referenced (joins)
    if (distinctTables.length > 1) {
      return {
        status: 'invalid',
        reason: 'All column references must be explicitly aliased when multiple tables are joined.',
      }
    }
    
    // Validate unaliased columns against single table
    if (distinctTables.length === 1) {
      const tableName = distinctTables[0].replace(/^public\./, '')
      const allowedColumns = ALLOWED_SQL_COLUMNS_BY_TABLE.get(tableName)
      
      for (const column of unaliasedColumns) {
        if (!allowedColumns?.has(column)) {
          return {
            status: 'invalid',
            reason: `Column ${column} is not allowlisted for table ${tableName}.`,
          }
        }
      }
    }
  }

  return { status: 'valid' }
}

function success(
  question: string,
  intent: TextToSqlIntent,
  parameters: unknown[],
): TextToSqlSuccess | TextToSqlUnsafe {
  const sql = SQL_BY_INTENT[intent]
  const validation = validateReadOnlySql(sql)

  if (validation.status === 'invalid') {
    return {
      status: 'unsafe',
      question,
      message: validation.reason,
      schemaDescription: getSqlSchemaDescription(),
    }
  }

  return {
    status: 'success',
    question,
    intent,
    sql,
    parameters,
    explanation: `Generated read-only SQL for ${intent}.`,
    schemaDescription: getSqlSchemaDescription(),
  }
}

function unsupported(question: string, message: string): TextToSqlUnsupported {
  return {
    status: 'unsupported',
    question,
    message,
    supportedExamples: [...SUPPORTED_EXAMPLES],
    schemaDescription: getSqlSchemaDescription(),
  }
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim()
}

function extractJobTitle(question: string): string | undefined {
  const quoted = question.match(/['"]([^'"]+)['"]/)
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim()
  }

  const afterJobTitle = question.match(
    /job title(?:\s+(?:of|is|=|called))?\s+([a-z][a-z\s/&-]{2,})(?:,|\?|$)/i,
  )

  return afterJobTitle?.[1]?.trim()
}

function extractReferencedTables(sql: string): string[] {
  const references = [...sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)]
  return references.map((match) => match[1].replace(/^public\./, 'public.'))
}

function extractAliasColumns(sql: string): Array<{ alias: string; column: string }> {
  // Extract all aliased column references: alias.column
  // But exclude schema.table references (e.g., public.campaign)
  const references = [...sql.matchAll(/\b([a-z_][a-z0-9_]*)\.("?)([a-z_][a-z0-9_]*)\2/gi)]

  // Filter out schema.table references like public.campaign, public.lead_event, etc.
  const schemaTableNames = new Set(['public'])
  const allowedTableNames = Array.from(ALLOWED_SQL_COLUMNS_BY_TABLE.keys())
  
  return references
    .filter((match) => {
      const prefix = match[1].toLowerCase()
      const column = match[3]
      
      // Skip if it's a schema reference like public.campaign
      if (schemaTableNames.has(prefix) && allowedTableNames.includes(column)) {
        return false
      }
      
      return true
    })
    .map((match) => ({
      alias: match[1].toLowerCase(),
      column: match[3],
    }))
}

function extractUnaliasedColumns(sql: string): string[] {
  // Extract SELECT clause columns (unaliased), handling multi-line clauses with dotAll flag
  const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM/is)
  if (!selectMatch) return []

  const selectClause = selectMatch[1]
  
  // Skip if it's COUNT(*) or other aggregate functions
  if (/COUNT\s*\(\s*\*\s*\)/i.test(selectClause) || selectClause.includes('*')) {
    return []
  }

  // Extract unaliased columns (not preceded by alias. and not functions)
  // Use 's' flag (dotAll) to match across newlines
  const unaliasedMatches = [
    ...selectClause.matchAll(/(?:^|,)\s*(?![a-z_][a-z0-9_]*\.)((?:[a-z_][a-z0-9_]*)|"[^"]*")\s*(?:AS\s+[a-z_][a-z0-9_]*)?/gi),
  ]

  return unaliasedMatches.map((match) => {
    const col = match[1].replace(/^"/, '').replace(/"$/, '')
    return col
  })
}

function resolveAlias(alias: string, sql: string): string | undefined {
  // Try to find the table that this alias refers to in the FROM clause
  // Pattern: (public\.)table_name (AS)? alias
  const tableNames = Array.from(ALLOWED_SQL_COLUMNS_BY_TABLE.keys()).join('|')
  const pattern = new RegExp(
    `\\b(?:public\\.)?(${tableNames})\\s+(?:AS\\s+)?${alias}\\b`,
    'i'
  )
  
  const match = sql.match(pattern)
  if (match) {
    return match[1].toLowerCase()
  }

  return undefined
}
