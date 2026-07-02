# Copilot instructions

This repository is a Google ADK TypeScript proof-of-concept for a LinkedIn Ads Campaign Intelligence Agent. It combines local mock campaign telemetry, vectorless lexical RAG over `doc.md`, deterministic Text-to-SQL, and a guarded PostgreSQL MCP bridge.

## Commands

- Install dependencies: `npm install`
- Build compiled output in `dist/`: `npm run build`
- Type-check without emitting files: `npm run typecheck`
- Run locally with ADK: `npm run adk:run`
- Run the ADK web UI locally with in-memory sessions: `npm run adk:web`
- Run the compiled production entrypoint: `npm start` after `npm run build`

Focused smoke checks are the closest equivalent to single tests in this repo:

- Local mock telemetry: `npm run smoke:local-data`
- OpenAI-compatible LLM adapter mapping: `npm run smoke:llm-adapter`
- Playbook/RAG behavior: `npm run smoke:rag`
- Text-to-SQL translation and SQL validation without a database: `npm run smoke:text-sql:translate`
- Database-backed Text-to-SQL execution: `npm run smoke:text-sql` after `DATABASE_URL` is configured and `npm run db:setup` has succeeded

Database setup scripts require `DATABASE_URL`: `npm run db:migrate`, `npm run db:seed`, `npm run db:verify`, `npm run db:setup`, and `npm run db:rollback`.

## Architecture

`agent.ts` exports `rootAgent`, the ADK `LlmAgent`, and wires all model-visible tools. Its routing contract is important: live spend questions call `get_live_campaign_spend`; audience scheduling questions call `get_audience_timezone`; LinkedIn Ads playbook questions call `search_doc`; campaign database questions call `text_to_sql` and only then `execute_validated_sql` when `DATABASE_URL` is configured.

The project has three data paths:

1. `sample-data.ts` contains volatile local mock telemetry used by the live spend and audience timezone tools.
2. `doc.md` is the LinkedIn B2B Advertising Playbook corpus. `rag.ts` loads it, splits it into blank-line chunks, caches chunks in process memory, scores lexical matches, and clamps `topK` to 1-5 snippets.
3. PostgreSQL campaign data flows through `text-to-sql.ts`, `sql-schema.ts`, and `postgres-mcp.ts`. Text-to-SQL is template-based, not generative SQL. `postgres-mcp.ts` starts `@henkey/postgres-mcp-server` over stdio and exposes only validated SELECT execution back to the agent.

`openai-compatible-llm.ts` adapts ADK `LlmRequest` objects to OpenAI Chat Completions requests, including function/tool declarations and tool responses. It reads `LLM_API_URL`, `LLM_API_TOKEN`, `LLM_MODEL`, and optional `LLM_FALLBACK_MODEL`.

`scripts/` contains top-level smoke and database scripts compiled by `tsc`; package scripts run `npm run build` before executing the corresponding `dist/scripts/*.js` file. The Dockerfile builds with Node 22 Alpine, prunes dev dependencies, copies `dist/` and `doc.md`, and runs `npm start`.

## Project-specific conventions

- This is strict ESM TypeScript with `moduleResolution: "NodeNext"`. Local TypeScript imports use `.js` extensions so compiled files run under Node ESM.
- Define model-callable capabilities as ADK `FunctionTool`s with `zod` parameter schemas in `agent.ts`, and return explicit status objects rather than throwing for expected tool-level failures.
- Do not expose `postgres_pg_execute_query` or any raw PostgreSQL MCP/admin tool to the LLM. Keep database access behind `text_to_sql` plus `execute_validated_sql`.
- Keep Text-to-SQL support deterministic. Add new database questions by extending the intent union, SQL template map, supported examples, schema allowlists, and smoke expectations together.
- SQL validation rejects CTEs, mutations, DDL, `SELECT INTO`, semicolon-separated statements, non-allowlisted tables, non-allowlisted columns, and unaliased columns in multi-table joins. Preserve these guardrails when changing database logic.
- The supported PostgreSQL domain is limited to `public.campaign`, `public.lead_event`, and `public.campaign_lead_map`; update `sql-schema.ts`, migration/seed/verify scripts, README tables, and smoke checks together if that domain changes.
- `doc.md` has smoke-tested structure: it must start with `# LinkedIn B2B Advertising Playbook 2026`, contain the required playbook section headers, and each required section must keep exactly 20 numbered rules.
- Do not read, print, commit, or modify `.env`. Use `.env.example` and README environment documentation for variable names, and surface missing configuration through the existing error/status patterns.
