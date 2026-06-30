export interface AllowedSqlColumn {
  name: string
  description: string
}

export interface AllowedSqlTable {
  schema: 'public'
  name: string
  description: string
  columns: readonly AllowedSqlColumn[]
}

export const ALLOWED_SQL_TABLES = [
  {
    schema: 'public',
    name: 'campaign',
    description: 'LinkedIn Ads campaign records synchronized for reporting.',
    columns: [
      { name: 'id', description: 'Campaign identifier.' },
      { name: 'name', description: 'Campaign display name.' },
      { name: 'objective', description: 'LinkedIn Ads campaign objective.' },
      { name: 'budget', description: 'Allocated campaign budget.' },
      { name: 'status', description: 'Campaign delivery status.' },
    ],
  },
  {
    schema: 'public',
    name: 'lead_event',
    description: 'Lead conversion events captured from LinkedIn Ads and CRM routing.',
    columns: [
      { name: 'id', description: 'Lead event identifier.' },
      { name: 'job_title', description: 'Lead professional job title.' },
      { name: 'company_name', description: 'Lead company name.' },
      { name: 'conversion_date', description: 'Date the lead converted.' },
    ],
  },
  {
    schema: 'public',
    name: 'campaign_lead_map',
    description: 'Mapping between campaigns and generated lead events.',
    columns: [
      { name: 'campaign_id', description: 'Campaign identifier by convention.' },
      { name: 'lead_event_id', description: 'Lead event identifier by convention.' },
      { name: 'cost_per_lead', description: 'Attributed cost per lead for the campaign-lead pair.' },
    ],
  },
] as const satisfies readonly AllowedSqlTable[]

export const ALLOWED_SQL_TABLE_NAMES = new Set(
  ALLOWED_SQL_TABLES.flatMap((table) => [
    table.name,
    `${table.schema}.${table.name}`,
  ]),
)

export const ALLOWED_SQL_COLUMNS_BY_TABLE = new Map<string, Set<string>>(
  ALLOWED_SQL_TABLES.map((table) => [
    table.name,
    new Set(table.columns.map((column) => column.name)),
  ]),
)

export const SAFE_SQL_JOIN_PATTERNS = [
  'public.campaign -> public.campaign_lead_map on campaign_lead_map.campaign_id = campaign.id',
  'public.campaign_lead_map -> public.lead_event on lead_event.id = campaign_lead_map.lead_event_id',
] as const

export function getSqlSchemaDescription(): string {
  return ALLOWED_SQL_TABLES.map((table) => {
    const columns = table.columns
      .map((column) => `${column.name}: ${column.description}`)
      .join('; ')

    return `${table.schema}.${table.name} (${columns})`
  }).join('\n')
}
