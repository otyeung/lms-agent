import 'dotenv/config'
import { MCPToolset } from '@google/adk'
import type { BaseTool, StdioConnectionParams } from '@google/adk'
import { validateReadOnlySql } from './text-to-sql.js'

const POSTGRES_MCP_PACKAGE = '@henkey/postgres-mcp-server'
const POSTGRES_MCP_NATIVE_QUERY_TOOL = 'pg_execute_query'
const POSTGRES_MCP_TOOL_PREFIX = 'postgres'

export const POSTGRES_MCP_AGENT_TOOL_NAME = `${POSTGRES_MCP_TOOL_PREFIX}_${POSTGRES_MCP_NATIVE_QUERY_TOOL}`

export interface FormattedPostgresMcpSelectResult {
  text: string
  format: 'markdown_table' | 'text'
  rowCount?: number
  rows?: Array<Record<string, unknown>>
  tableMarkdown?: string
}

export function isPostgresMcpConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function createPostgresMcpToolset(): MCPToolset {
  const connectionString = readDatabaseUrl()
  const connectionParams: StdioConnectionParams = {
    type: 'StdioConnectionParams',
    timeout: 30000,
    serverParams: {
      command: 'npx',
      args: ['-y', POSTGRES_MCP_PACKAGE],
      cwd: process.cwd(),
      env: buildMcpEnvironment(connectionString),
      stderr: 'pipe',
    },
  }

  return new MCPToolset(
    connectionParams,
    [POSTGRES_MCP_AGENT_TOOL_NAME],
    POSTGRES_MCP_TOOL_PREFIX,
  )
}

export async function runPostgresMcpSelect(
  sql: string,
  parameters: unknown[] = [],
  limit = 1000,
): Promise<string> {
  const validation = validateReadOnlySql(sql)

  if (validation.status === 'invalid') {
    throw new Error(`Refusing unsafe SQL: ${validation.reason}`)
  }

  const toolset = createPostgresMcpToolset()

  try {
    const queryTool = await findPostgresQueryTool(toolset)
    const response = await queryTool.runAsync({
      args: {
        operation: 'select',
        query: sql,
        parameters,
        limit,
      },
      toolContext: { abortSignal: undefined } as never,
    })

    return extractMcpText(response)
  } finally {
    await toolset.close()
  }
}

export function formatPostgresMcpSelectResult(
  responseText: string,
): FormattedPostgresMcpSelectResult {
  const rows = extractRows(responseText)
  const columns = rows ? collectColumns(rows) : []

  if (!rows || rows.length === 0 || columns.length === 0) {
    return { text: responseText, format: 'text' }
  }

  return {
    text: responseText,
    format: 'markdown_table',
    rowCount: rows.length,
    rows,
    tableMarkdown: toMarkdownTable(columns, rows),
  }
}

async function findPostgresQueryTool(toolset: MCPToolset): Promise<BaseTool> {
  const tools = await toolset.getTools()
  const queryTool = tools.find((tool) => tool.name === POSTGRES_MCP_AGENT_TOOL_NAME)

  if (!queryTool) {
    throw new Error(`PostgreSQL MCP tool ${POSTGRES_MCP_AGENT_TOOL_NAME} was not found.`)
  }

  return queryTool
}

function readDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL?.trim()

  if (!connectionString) {
    throw new Error('Set DATABASE_URL in .env before using PostgreSQL MCP.')
  }

  return connectionString
}

function buildMcpEnvironment(connectionString: string): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        entry[0] !== 'DATABASE_URL' &&
        entry[0] !== 'POSTGRES_CONNECTION_STRING',
    ),
  )

  env.POSTGRES_CONNECTION_STRING = connectionString
  return env
}

function extractMcpText(response: unknown): string {
  if (
    typeof response === 'object' &&
    response !== null &&
    'content' in response &&
    Array.isArray((response as { content: unknown }).content)
  ) {
    return (response as { content: Array<{ text?: unknown }> }).content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }

  return String(response)
}

function extractRows(responseText: string): Array<Record<string, unknown>> | undefined {
  const marker = 'Results:\n'
  const markerIndex = responseText.indexOf(marker)

  if (markerIndex === -1) {
    return undefined
  }

  try {
    const parsed = JSON.parse(responseText.slice(markerIndex + marker.length).trim())

    if (
      !Array.isArray(parsed) ||
      parsed.some((row) => !isRecord(row))
    ) {
      return undefined
    }

    return parsed
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns: string[] = []

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!columns.includes(column)) {
        columns.push(column)
      }
    }
  }

  return columns
}

function toMarkdownTable(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const header = `| ${columns.map(escapeMarkdownCell).join(' | ')} |`
  const separator = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map(
    (row) =>
      `| ${columns
        .map((column) => escapeMarkdownCell(formatCellValue(row[column])))
        .join(' | ')} |`,
  )

  return [header, separator, ...body].join('\n')
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}
