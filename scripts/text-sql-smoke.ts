import { runPostgresMcpSelect } from '../postgres-mcp.js'
import { translateQuestionToSql } from '../text-to-sql.js'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

async function runQuestion(question: string): Promise<unknown[]> {
  const translation = translateQuestionToSql(question)

  assert(
    translation.status === 'success',
    `${question} should translate successfully`,
  )

  if (translation.status !== 'success') {
    return []
  }

  const responseText = await runPostgresMcpSelect(
    translation.sql,
    translation.parameters,
    1000,
  )

  return extractRows(responseText)
}

const activeCampaignRows = await runQuestion(
  'How many active campaigns do we currently have running?',
)
assert(
  Number((activeCampaignRows[0] as { active_campaigns: number | string }).active_campaigns) === 150,
  'active campaign count should be 150',
)

const highestBudgetRows = await runQuestion(
  'Which campaign has the highest allocated budget?',
)
assert(highestBudgetRows.length === 1, 'highest budget query should return one campaign')
const highestBudget = highestBudgetRows[0] as {
  id: number
  name: string
  budget: number | string
}
assert(highestBudget.id === 1, 'highest budget campaign id should be 1')
assert(
  highestBudget.name === 'Q3 Cloud Migration - NA',
  'highest budget campaign should be Q3 Cloud Migration - NA',
)
assert(Number(highestBudget.budget) === 100000, 'highest campaign budget should be 100000')

const directorRows = await runQuestion(
  'Which campaigns generated leads with the \'Director of IT\' job title, and what are their company names?',
)
assert(directorRows.length >= 1, 'Director of IT query should return at least one row')
assert(
  directorRows.some(
    (row) =>
      (row as { campaign_name: string }).campaign_name === 'Q3 Cloud Migration - NA' &&
      (row as { job_title: string }).job_title === 'Director of IT' &&
      (row as { company_name: string }).company_name === 'Acme Corp',
  ),
  'Director of IT query should include Acme Corp from Q3 Cloud Migration - NA',
)

const campaignListRows = await runQuestion(
  'list all campaigns from 1st to 200th record',
)
assert(campaignListRows.length === 200, 'campaign list query should return 200 rows')
const firstCampaign = campaignListRows[0] as { id: number; name: string }
const lastCampaign = campaignListRows[199] as { id: number; name: string }
assert(firstCampaign.id === 1, 'first campaign list row should have id 1')
assert(
  firstCampaign.name === 'Q3 Cloud Migration - NA',
  'first campaign list row should be Q3 Cloud Migration - NA',
)
assert(lastCampaign.id === 200, 'last campaign list row should have id 200')

console.log('Text-to-SQL MCP smoke passed')

function extractRows(responseText: string): unknown[] {
  const marker = 'Results:\n'
  const markerIndex = responseText.indexOf(marker)

  if (markerIndex === -1) {
    throw new Error(`MCP response did not include result rows: ${responseText}`)
  }

  return JSON.parse(responseText.slice(markerIndex + marker.length)) as unknown[]
}
