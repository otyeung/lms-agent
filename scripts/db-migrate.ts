import { withPostgresClient } from './db-client.js'

const schemaSql = `
DROP TABLE IF EXISTS public.course_student_map;
DROP TABLE IF EXISTS public.course;
DROP TABLE IF EXISTS public.student;

CREATE TABLE IF NOT EXISTS public.campaign (
    id integer PRIMARY KEY,
    name character varying NOT NULL,
    objective character varying NOT NULL,
    budget numeric(12, 2) NOT NULL CHECK (budget >= 5000 AND budget <= 100000),
    status character varying NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED'))
);

CREATE TABLE IF NOT EXISTS public.lead_event (
    id integer PRIMARY KEY,
    job_title character varying NOT NULL,
    company_name character varying NOT NULL,
    conversion_date date NOT NULL
);

CREATE TABLE IF NOT EXISTS public.campaign_lead_map (
    campaign_id integer NOT NULL REFERENCES public.campaign(id) ON DELETE CASCADE,
    lead_event_id integer NOT NULL REFERENCES public.lead_event(id) ON DELETE CASCADE,
    cost_per_lead numeric(10, 2) NOT NULL CHECK (cost_per_lead > 0),
    PRIMARY KEY (campaign_id, lead_event_id)
);
`

await withPostgresClient(async (client) => {
  await client.query(schemaSql)
})

console.log('Applied LinkedIn Ads campaign schema')
