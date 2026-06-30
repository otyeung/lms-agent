import 'dotenv/config'
import { FunctionTool, LlmAgent } from '@google/adk'
import type { ToolUnion } from '@google/adk'
import { z } from 'zod'
import {
  formatPostgresMcpSelectResult,
  isPostgresMcpConfigured,
  runPostgresMcpSelect,
} from './postgres-mcp.js'
import {
  createConfiguredLlm,
  isOpenAICompatibleLlmConfigured,
} from './openai-compatible-llm.js'
import { searchDocument } from './rag.js'
import {
  audienceTargetingTimezones,
  liveCampaignSpendData,
} from './sample-data.js'
import { translateQuestionToSql } from './text-to-sql.js'

const getLiveCampaignSpend = new FunctionTool({
  name: 'get_live_campaign_spend',
  description:
    'Returns today\'s live LinkedIn Ads spend and budget utilization for a specified campaign.',
  parameters: z.object({
    campaignName: z
      .string()
      .describe('The LinkedIn Ads campaign name to retrieve live spend for.'),
  }),
  execute: ({ campaignName }) => {
    const spend = liveCampaignSpendData.find(
      (item) => item.campaignName.toLowerCase() === campaignName.toLowerCase(),
    )

    if (spend) {
      return {
        status: 'success',
        report: `${spend.campaignName} has spent $${spend.spendToday.toFixed(2)} today with ${spend.utilization} budget utilization.`,
      }
    }

    return {
      status: 'error',
      report: `Live campaign spend data not found for ${campaignName}.`,
    }
  },
})

const getAudienceTimezone = new FunctionTool({
  name: 'get_audience_timezone',
  description:
    'Returns the recommended IANA timezone for scheduling LinkedIn Ads delivery to a B2B audience segment.',
  parameters: z.object({
    audience: z
      .string()
      .describe('The B2B audience segment to retrieve the target timezone for.'),
  }),
  execute: ({ audience }) => {
    const timezone = audienceTargetingTimezones[audience.toLowerCase()]

    if (timezone) {
      return {
        status: 'success',
        report: `The target timezone for ${audience} is ${timezone}.`,
      }
    }

    return {
      status: 'error',
      report: `Audience timezone data not found for ${audience}.`,
    }
  },
})

const searchDoc = new FunctionTool({
  name: 'search_doc',
  description:
    'Searches the local LinkedIn B2B Advertising Playbook and returns relevant snippets for document-grounded campaign recommendations.',
  parameters: z.object({
    query: z.string().describe('The user question to search for in doc.md.'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('Maximum number of document snippets to return.'),
  }),
  execute: ({ query, topK }) => searchDocument(query, topK),
})

const textToSql = new FunctionTool({
  name: 'text_to_sql',
  description:
    'Translates supported LinkedIn Ads campaign and lead database questions into safe read-only SQL for PostgreSQL execution.',
  parameters: z.object({
    question: z
      .string()
      .describe('The natural-language campaign database question to translate.'),
  }),
  execute: ({ question }) => ({
    ...translateQuestionToSql(question),
    databaseConfigured: isPostgresMcpConfigured(),
    executionToolName: 'execute_validated_sql',
  }),
})

const executeValidatedSql = new FunctionTool({
  name: 'execute_validated_sql',
  description:
    'Executes a validated read-only SQL query through the PostgreSQL MCP bridge. ' +
    'Only SELECT queries that pass the read-only allowlist check are accepted; ' +
    'CTE, mutation, DDL, and arbitrary SQL are rejected before execution.',
  parameters: z.object({
    sql: z.string().describe('The SQL SELECT query to execute.'),
    parameters: z
      .array(z.unknown())
      .optional()
      .describe('Optional positional parameters for parameterized queries (e.g. $1 placeholders).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Maximum number of rows to return (default 1000).'),
  }),
  execute: async ({ sql, parameters, limit }) => {
    try {
      const result = await runPostgresMcpSelect(sql, parameters ?? [], limit ?? 1000)
      const formattedResult = formatPostgresMcpSelectResult(result)
      return {
        status: 'success',
        result,
        ...formattedResult,
        presentation:
          formattedResult.format === 'markdown_table'
            ? 'Return tableMarkdown as a Markdown table. Do not collapse rows into prose.'
            : 'Summarize the result in concise prose.',
      }
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },
})

function buildTools(): ToolUnion[] {
  const tools: ToolUnion[] = [
    getLiveCampaignSpend,
    getAudienceTimezone,
    searchDoc,
    textToSql,
  ]

  if (isPostgresMcpConfigured()) {
    tools.push(executeValidatedSql)
  }

  return tools
}

export const rootAgent = new LlmAgent({
  name: 'linkedin_ads_intelligence_agent',
  model: createConfiguredLlm(),
  description:
    'An Enterprise B2B Marketing AI Agent for LinkedIn Ads campaign intelligence, playbook guidance, and CRM-backed lead analytics.',
  instruction: `You are an Enterprise B2B Marketing AI Agent specializing in LinkedIn Ads campaign intelligence for enterprise software teams.

Always use the provided tools to fetch factual campaign data before answering user prompts.

For live campaign spend or utilization questions, call get_live_campaign_spend before answering.
For B2B audience timezone or scheduling questions, call get_audience_timezone before answering.
For questions about LinkedIn Ads best practices, Lead Gen Forms, bidding, budgeting, ad formats, creative, audience targeting, analytics, or tracking, call search_doc before answering.

For database questions about campaigns, listing campaign records, active campaigns, campaign budgets, lead events, job titles, company names, or cost per lead:
1. Call text_to_sql with the user's original question.
2. If text_to_sql returns status "success" and databaseConfigured is true, call execute_validated_sql with the sql and parameters values returned by text_to_sql.
3. If execute_validated_sql returns tableMarkdown, present that Markdown table directly and do not collapse table rows into prose. Otherwise summarize the PostgreSQL result in natural language and mention that it came from the PostgreSQL campaign database.
4. If text_to_sql returns status "unsupported" or "unsafe", explain the supported database question examples instead of guessing.
5. If databaseConfigured is false, tell the user to set DATABASE_URL in .env before running database-backed questions.
6. Do NOT call postgres_pg_execute_query or any other raw MCP tool directly; always use execute_validated_sql.

When using search_doc, answer only from the returned snippets. If search_doc returns status "error" or "no_match", say the local LinkedIn Ads playbook does not contain enough information instead of guessing.`,
  tools: buildTools(),
  beforeModelCallback: () => {
    if (isOpenAICompatibleLlmConfigured()) {
      return undefined
    }

    return {
      content: {
        role: 'model',
        parts: [
          {
            text: 'Set LLM_API_URL and LLM_API_TOKEN in .env, then restart the ADK web server.',
          },
        ],
      },
    }
  },
})
