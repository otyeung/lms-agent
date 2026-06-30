import { withPostgresClient } from './db-client.js'

const campaignThemes = [
  'Q3 Cloud Migration',
  'Zero Trust Security',
  'GenAI Webinar',
  'Hybrid Cloud CFO Briefing',
  'Enterprise Data Fabric',
  'Developer Platform Trial',
  'CISO Ransomware Readiness',
  'AI Governance Executive Forum',
  'Manufacturing IoT Modernization',
  'FinOps Cost Optimization',
  'CRM Integration ABM',
  'Secure Access Service Edge',
  'Data Warehouse Migration',
  'Marketing Automation MQL Surge',
  'Healthcare Compliance Cloud',
  'Financial Services Risk Analytics',
  'Retail Personalization Platform',
  'Supply Chain Control Tower',
  'DevSecOps Pipeline Acceleration',
  'Kubernetes Management',
]

const regions = [
  'NA',
  'EMEA',
  'APAC',
  'LATAM',
  'UKI',
  'DACH',
  'ANZ',
  'Japan',
  'ASEAN',
  'Canada',
]

const objectives = [
  'Lead Generation',
  'Brand Awareness',
  'Website Conversions',
  'Event Registrations',
  'Thought Leadership',
  'Account-Based Marketing',
  'Product Demo Requests',
  'Pipeline Acceleration',
]

const jobTitles = [
  'Director of IT',
  'VP of Engineering',
  'CISO',
  'Chief Information Officer',
  'Cloud Architect',
  'Head of Data Platform',
  'Security Operations Manager',
  'Director of Marketing Operations',
  'Revenue Operations Lead',
  'Procurement Director',
  'Chief Financial Officer',
  'VP of Infrastructure',
  'Enterprise Architect',
  'Director of Analytics',
  'IT Operations Manager',
  'Chief Data Officer',
  'VP of Product',
  'Digital Transformation Lead',
  'Compliance Director',
  'Platform Engineering Manager',
]

const companyNames = [
  'Acme Corp',
  'TechFlow',
  'Nimbus Systems',
  'Northstar Analytics',
  'BluePeak Software',
  'QuantumBridge',
  'VertexCloud',
  'Summit Financial',
  'HealthGrid',
  'Apex Manufacturing',
  'BrightRetail',
  'Cobalt Security',
  'Evergreen Logistics',
  'IronGate Technologies',
  'Lucent Data',
  'Meridian Robotics',
  'OrbitOps',
  'Pinnacle Insurance',
  'Redwood Platforms',
  'Sterling AI',
]

function randomMoney(min: number, max: number): number {
  return Number((Math.random() * (max - min) + min).toFixed(2))
}

function campaignNameFor(index: number): string {
  if (index === 1) {
    return 'Q3 Cloud Migration - NA'
  }

  const theme = campaignThemes[(index - 1) % campaignThemes.length]
  const region = regions[Math.floor((index - 1) / campaignThemes.length) % regions.length]
  return `${theme} - ${region} ${Math.ceil(index / campaignThemes.length)}`
}

function conversionDateFor(index: number): string {
  const month = String((index % 12) + 1).padStart(2, '0')
  const day = String((index % 28) + 1).padStart(2, '0')
  return `2026-${month}-${day}`
}

await withPostgresClient(async (client) => {
  await client.query('BEGIN')

  try {
    await client.query('TRUNCATE public.campaign_lead_map, public.lead_event, public.campaign RESTART IDENTITY')

    for (let index = 1; index <= 200; index += 1) {
      const name = campaignNameFor(index)
      const objective = objectives[(index - 1) % objectives.length]
      const budget = index === 1 ? 100000 : randomMoney(5000, 99000)
      const status = index % 4 === 0 ? 'PAUSED' : 'ACTIVE'

      await client.query(
        'INSERT INTO public.campaign (id, name, objective, budget, status) VALUES ($1, $2, $3, $4, $5)',
        [index, name, objective, budget, status],
      )
    }

    for (let index = 1; index <= 200; index += 1) {
      const jobTitle = index === 1 ? 'Director of IT' : jobTitles[(index - 1) % jobTitles.length]
      const companyName = index === 1 ? 'Acme Corp' : companyNames[(index - 1) % companyNames.length]
      const conversionDate = conversionDateFor(index)

      await client.query(
        'INSERT INTO public.lead_event (id, job_title, company_name, conversion_date) VALUES ($1, $2, $3, $4)',
        [index, jobTitle, companyName, conversionDate],
      )
    }

    await client.query(
      'INSERT INTO public.campaign_lead_map (campaign_id, lead_event_id, cost_per_lead) VALUES ($1, $2, $3)',
      [1, 1, 87.5],
    )

    const pairs = new Set(['1:1'])
    while (pairs.size < 250) {
      const campaignId = Math.floor(Math.random() * 200) + 1
      const leadEventId = Math.floor(Math.random() * 200) + 1
      const pairKey = `${campaignId}:${leadEventId}`

      if (pairs.has(pairKey)) {
        continue
      }

      pairs.add(pairKey)
      await client.query(
        'INSERT INTO public.campaign_lead_map (campaign_id, lead_event_id, cost_per_lead) VALUES ($1, $2, $3)',
        [campaignId, leadEventId, randomMoney(45, 650)],
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
})

console.log('Seeded 200 campaigns, 200 lead events, and 250 campaign-lead mappings')
