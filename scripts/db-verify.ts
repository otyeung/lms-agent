import { withPostgresClient } from './db-client.js'

interface SeedCounts {
  campaigns: string
  lead_events: string
  mappings: string
  active_campaigns: string
  paused_campaigns: string
  invalid_statuses: string
  campaigns_in_budget_range: string
  director_it_leads: string
  mapped_director_it_leads: string
  highest_budget_campaigns: string
}

const result = await withPostgresClient(async (client) =>
  client.query<SeedCounts>(`
    SELECT
      (SELECT COUNT(*) FROM public.campaign) AS campaigns,
      (SELECT COUNT(*) FROM public.lead_event) AS lead_events,
      (SELECT COUNT(*) FROM public.campaign_lead_map) AS mappings,
      (SELECT COUNT(*) FROM public.campaign WHERE status = 'ACTIVE') AS active_campaigns,
      (SELECT COUNT(*) FROM public.campaign WHERE status = 'PAUSED') AS paused_campaigns,
      (SELECT COUNT(*) FROM public.campaign WHERE status NOT IN ('ACTIVE', 'PAUSED')) AS invalid_statuses,
      (
        SELECT COUNT(*)
        FROM public.campaign
        WHERE budget BETWEEN 5000 AND 100000
      ) AS campaigns_in_budget_range,
      (
        SELECT COUNT(*)
        FROM public.lead_event
        WHERE job_title = 'Director of IT'
      ) AS director_it_leads,
      (
        SELECT COUNT(*)
        FROM public.campaign_lead_map AS clm
        JOIN public.lead_event AS l ON l.id = clm.lead_event_id
        WHERE l.job_title = 'Director of IT'
      ) AS mapped_director_it_leads,
      (
        SELECT COUNT(*)
        FROM public.campaign
        WHERE budget = (SELECT MAX(budget) FROM public.campaign)
      ) AS highest_budget_campaigns
  `),
)

const counts = result.rows[0]

if (!counts) {
  throw new Error('Unable to read seed counts.')
}

const campaigns = Number(counts.campaigns)
const leadEvents = Number(counts.lead_events)
const mappings = Number(counts.mappings)
const activeCampaigns = Number(counts.active_campaigns)
const pausedCampaigns = Number(counts.paused_campaigns)
const invalidStatuses = Number(counts.invalid_statuses)
const campaignsInBudgetRange = Number(counts.campaigns_in_budget_range)
const directorItLeads = Number(counts.director_it_leads)
const mappedDirectorItLeads = Number(counts.mapped_director_it_leads)
const highestBudgetCampaigns = Number(counts.highest_budget_campaigns)

if (
  campaigns < 200 ||
  leadEvents < 200 ||
  mappings < 250 ||
  activeCampaigns !== 150 ||
  pausedCampaigns !== 50 ||
  invalidStatuses !== 0 ||
  campaignsInBudgetRange !== campaigns ||
  directorItLeads < 1 ||
  mappedDirectorItLeads < 1 ||
  highestBudgetCampaigns < 1
) {
  throw new Error(
    `Unexpected seed counts: campaigns=${campaigns}, leadEvents=${leadEvents}, mappings=${mappings}, activeCampaigns=${activeCampaigns}, pausedCampaigns=${pausedCampaigns}, invalidStatuses=${invalidStatuses}, campaignsInBudgetRange=${campaignsInBudgetRange}, directorItLeads=${directorItLeads}, mappedDirectorItLeads=${mappedDirectorItLeads}, highestBudgetCampaigns=${highestBudgetCampaigns}`,
  )
}

console.log(
  `Verified database seed: ${campaigns} campaigns, ${activeCampaigns} active, ${pausedCampaigns} paused, ${leadEvents} lead events, ${mappings} mappings`,
)
