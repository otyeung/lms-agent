import {
  formatPostgresMcpSelectResult,
} from '../postgres-mcp.js'
import {
  translateQuestionToSql,
  validateReadOnlySql,
} from '../text-to-sql.js'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const expectedSqlByQuestion = new Map([
  [
    'How many active campaigns do we currently have running?',
    `SELECT COUNT(*) AS active_campaigns FROM public.campaign WHERE status = 'ACTIVE'`,
  ],
  [
    'Which campaign has the highest allocated budget?',
    `SELECT id, name, budget FROM public.campaign WHERE budget = (SELECT MAX(budget) FROM public.campaign) ORDER BY id`,
  ],
  [
    'Which campaigns generated leads with the \'Director of IT\' job title, and what are their company names?',
    `SELECT c.name AS campaign_name, l.job_title, l.company_name, clm.cost_per_lead FROM public.campaign AS c JOIN public.campaign_lead_map AS clm ON clm.campaign_id = c.id JOIN public.lead_event AS l ON l.id = clm.lead_event_id WHERE l.job_title ILIKE $1 ORDER BY clm.cost_per_lead ASC`,
  ],
  [
    'list all campaigns from 1st to 200th record',
    `SELECT id, name, objective, budget, status FROM public.campaign ORDER BY id LIMIT 200`,
  ],
])

for (const [question, expectedSql] of expectedSqlByQuestion) {
  const result = translateQuestionToSql(question)
  assert(result.status === 'success', `${question} should translate successfully`)

  if (result.status !== 'success') {
    continue
  }

  assert(result.sql === expectedSql, `${question} produced unexpected SQL`)
  assert(
    validateReadOnlySql(result.sql).status === 'valid',
    `${question} produced SQL that failed validation`,
  )

  if (result.intent === 'leads_by_job_title') {
    assert(
      result.parameters[0] === '%Director of IT%',
      'Director of IT query should use a parameterized ILIKE pattern',
    )
  }
}

const unsafe = validateReadOnlySql('DROP TABLE public.campaign')
assert(unsafe.status === 'invalid', 'DROP TABLE should be rejected')

const unsupported = translateQuestionToSql('delete all campaigns')
assert(unsupported.status === 'unsupported', 'write request should be unsupported')

const unaliasedDisallowedColumn = validateReadOnlySql(
  'SELECT secret FROM public.campaign',
)
assert(
  unaliasedDisallowedColumn.status === 'invalid',
  'Unaliased disallowed column should be rejected',
)

const nonStandardAliasDisallowed = validateReadOnlySql(
  'SELECT t.secret FROM public.campaign AS t',
)
assert(
  nonStandardAliasDisallowed.status === 'invalid',
  'Non-standard alias with non-existent column should be rejected',
)

const nonStandardAliasAllowed = validateReadOnlySql(
  'SELECT t.id FROM public.campaign AS t',
)
assert(
  nonStandardAliasAllowed.status === 'valid',
  'Non-standard alias with allowed column should be valid',
)

const subqueryBypass = validateReadOnlySql(
  'SELECT secret FROM public.campaign WHERE id = (SELECT MAX(id) FROM public.campaign)',
)
assert(
  subqueryBypass.status === 'invalid',
  'Unaliased disallowed column with subquery should be rejected',
)

const noFromBypass = validateReadOnlySql('SELECT pg_read_file(\'/etc/passwd\')')
assert(
  noFromBypass.status === 'invalid',
  'SELECT without FROM clause should be rejected',
)

const multilineBypass = validateReadOnlySql(
  'SELECT id,\nsecret\nFROM public.campaign',
)
assert(
  multilineBypass.status === 'invalid',
  'Multi-line SELECT with unaliased disallowed column should be rejected',
)

const unaliasedMultiTableBypass = validateReadOnlySql(
  'SELECT secret FROM public.campaign JOIN public.lead_event ON public.lead_event.id = public.campaign.id',
)
assert(
  unaliasedMultiTableBypass.status === 'invalid',
  'Unaliased column in multi-table JOIN should be rejected',
)

const withBypass = validateReadOnlySql(
  'WITH cte AS (SELECT 1) SELECT pg_read_file(\'/etc/passwd\')',
)
assert(withBypass.status === 'invalid', 'WITH-headed query should be rejected')

const cteWriteBypass = validateReadOnlySql(
  'WITH x AS (DELETE FROM public.campaign RETURNING *) SELECT * FROM x',
)
assert(cteWriteBypass.status === 'invalid', 'CTE write bypass must be rejected')

const selectIntoBypass = validateReadOnlySql(
  'SELECT id, name INTO evil_copy FROM public.campaign',
)
assert(selectIntoBypass.status === 'invalid', 'SELECT INTO bypass must be rejected')

const formattedResult = formatPostgresMcpSelectResult(
  'Results:\n' +
    JSON.stringify([
      {
        id: 1,
        name: 'Q3 Cloud Migration - NA',
        objective: 'Lead Generation',
        budget: '100000.00',
        status: 'ACTIVE',
      },
      {
        id: 2,
        name: 'Zero Trust Security - NA 1',
        objective: 'Brand Awareness',
        budget: '18074.19',
        status: 'ACTIVE',
      },
    ]),
)
assert(
  formattedResult.tableMarkdown ===
    '| id | name | objective | budget | status |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| 1 | Q3 Cloud Migration - NA | Lead Generation | 100000.00 | ACTIVE |\n' +
      '| 2 | Zero Trust Security - NA 1 | Brand Awareness | 18074.19 | ACTIVE |',
  'PostgreSQL row arrays should be formatted as a Markdown table',
)

console.log('Text-to-SQL translation smoke passed')
