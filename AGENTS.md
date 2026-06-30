# AGENTS.md

This file gives coding agents the project-specific context needed to work safely in this repository.

## Project summary

This is a proof-of-concept for a **LinkedIn Ads Campaign Intelligence Agent** built with Google ADK TypeScript. It demonstrates local volatile tool calling, vectorless lexical RAG, deterministic Text-to-SQL, and a validated PostgreSQL MCP bridge for enterprise B2B marketing analytics.

## Routing logic

- Use `get_live_campaign_spend` for campaign spend and budget utilization questions.
- Use `get_audience_timezone` for B2B audience timezone and ad scheduling questions.
- Use `search_doc` for LinkedIn Ads playbook questions covering Lead Gen Forms, bidding, budgeting, creative, targeting, analytics, and tracking.
- Use `text_to_sql` followed by `execute_validated_sql` for supported campaign database questions.

## Database domain

The supported PostgreSQL tables are:

- `public.campaign(id, name, objective, budget, status)`
- `public.lead_event(id, job_title, company_name, conversion_date)`
- `public.campaign_lead_map(campaign_id, lead_event_id, cost_per_lead)`

Supported Text-to-SQL intents are:

- `campaign_count`
- `highest_budget_campaign`
- `leads_by_job_title`
- `campaign_list`

## Enterprise guardrails

- The raw `postgres_pg_execute_query` MCP tool is not exposed to the LLM.
- `execute_validated_sql` validates SQL before calling the MCP bridge.
- The validator rejects CTEs, mutations, DDL, SELECT INTO, non-allowlisted tables, and non-allowlisted columns.
- Do not add write queries, arbitrary SQL execution, import/export, or admin database tools.
- Never read, print, commit, or modify `.env`.

## Commands

```bash
npm install
npm run typecheck
npm run smoke:local-data
npm run smoke:llm-adapter
npm run smoke:rag
npm run smoke:text-sql:translate
npm run db:setup
npm run smoke:text-sql
npm run adk:run
npm run adk:web
```

Use `npm run typecheck` after TypeScript changes. Use `npm run smoke:rag` after changing `doc.md`, `rag.ts`, `agent.ts`, or `scripts/rag-smoke.ts`. Use `npm run smoke:text-sql:translate` after changing `sql-schema.ts`, `text-to-sql.ts`, or SQL validation. Use `npm run db:setup` and `npm run smoke:text-sql` after changing database schema, seed behavior, MCP execution, or Text-to-SQL execution flow.
