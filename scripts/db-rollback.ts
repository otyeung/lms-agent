import { withPostgresClient } from './db-client.js'

await withPostgresClient(async (client) => {
  await client.query(`
    DROP TABLE IF EXISTS public.campaign_lead_map;
    DROP TABLE IF EXISTS public.lead_event;
    DROP TABLE IF EXISTS public.campaign;
  `)
})

console.log('Rolled back LinkedIn Ads campaign schema')
