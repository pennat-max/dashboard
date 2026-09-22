# LINE n8n Chang Joe Dry-Run Runbook

Purpose: let Chang Joe import and test the LINE Inbox n8n workflow without changing production LINE, Supabase, Vercel, or ChatGPT Site behavior.

## Safety Defaults

Keep these values for every first test:

```text
ACTIVE=false
DRY_RUN=true
AUTO_SAVE=false
LINE_REPLY=false
```

Do not put real secrets in the workflow JSON. Store real tokens only in n8n credentials or environment variables on Chang Joe's machine.

## Files

- Plan: `docs/line-n8n-chang-joe-plan.md`
- Importable n8n workflow: `docs/line-n8n-chang-joe-dry-run.workflow.json`
- This runbook: `docs/line-n8n-chang-joe-runbook.md`

## Before Import

1. Confirm n8n is running only on Chang Joe's machine or approved test host.
2. Confirm the workflow JSON still has `"active": false`.
3. Confirm the workflow JSON still uses placeholders:
   - `https://CHATGPT_SITE_HOST.example`
   - `Bearer __SET_IN_N8N_CREDENTIALS_ONLY__`
4. Prepare the test base URL separately in n8n, not in git.
5. Do not configure LINE access token, LINE channel secret, Supabase service role key, or production database password in exported workflow JSON.

## Import Steps

1. Open n8n.
2. Choose import from file or paste JSON.
3. Import `docs/line-n8n-chang-joe-dry-run.workflow.json`.
4. Leave the workflow inactive.
5. Rename the imported workflow if helpful, for example `LINE Inbox - Chang Joe Dry Run`.
6. Open the `Dry Run Config` node.
7. Replace only local test values inside n8n:
   - `CHATGPT_SITE_BASE_URL`
   - auth header through n8n credential/env handling
8. Save without activating the workflow.

## First Manual Test

Run manually once.

Expected behavior:

- The workflow calls the pending queue summary endpoint.
- If the pending queue returns `401`, `403`, or another HTTP failure after retry, the workflow routes to `HTTP Error Queue No-Op` and stops without saving or replying.
- Messages are classified into:
  - `high_confidence`
  - `human_review`
  - `blocked`
- The classifier accepts both pending queue shapes:
  - `action_lines` from the newer grouped queue payload
  - `new_lines` from the older/simple queue payload
- High-confidence rows go to a no-op node.
- Human-review rows go to a no-op node.
- Blocked rows go to a no-op error queue node.
- Empty queues go to `Empty Queue No-Op`.
- No call is made to `pending-save`, `confirm`, LINE reply, LINE push, Supabase migration, or production webhook settings.

Stop immediately if any node attempts to:

- call `/api/line-inbox/pending-save`,
- call `/api/line-inbox/confirm`,
- call LINE reply/push APIs,
- write directly to Supabase,
- use a service role key,
- activate a production webhook.

## Dry-Run Checklist

For each test execution, record:

- execution time,
- base URL used,
- total items pulled,
- high-confidence count,
- human-review count,
- blocked count,
- HTTP errors,
- whether any real write/reply path was attempted.

Pass criteria:

- workflow remains inactive after test,
- dry-run flags remain unchanged,
- no real save,
- no LINE reply,
- no secret in exported workflow,
- no production config changed.

## Common Failures

### 401 or 403

Auth is missing or not accepted by the target app. In workflow v2 this should route to `HTTP Error Queue No-Op`; keep the workflow dry-run and fix server-side auth design before continuing.

### Pending queue shape mismatch

Workflow v2 handles both `action_lines` and `new_lines`. If a future API shape changes again, keep the row in human review or blocked; do not add save/reply behavior until the parser contract is updated.

### 404

The base URL is wrong, the app is not deployed at that host, or the route is not available on the target environment.

### Empty queue

This is acceptable. It may mean there are no pending `line_inbox_messages`, the table is missing, webhook ingest is disabled, or the test environment has no LINE data.

### Blocked rows only

Usually caused by missing car match, ambiguous vehicle text, image-only rows, or missing analyze payload. Keep these in human review/blocked until staff confirms the matching rule.

## What Not To Do

- Do not activate the workflow on a schedule yet.
- Do not change the production LINE webhook URL.
- Do not enable `AUTO_SAVE`.
- Do not enable `LINE_REPLY`.
- Do not paste secrets into sticky notes, Set nodes, docs, commit messages, screenshots, or PR comments.
- Do not apply Supabase migrations.
- Do not push to `master`.
- Do not force push.

## Approval Needed Before Real Mode

Before any write/reply behavior is enabled, owners must approve:

- ChatGPT Site URL and production/rollback target,
- n8n server-side auth method,
- idempotency policy,
- audit log policy,
- exact save endpoint,
- LINE reply text,
- LINE rate limits,
- allowed LINE group IDs,
- attachment storage plan,
- rollback steps to Vercel,
- dry-run evidence from Chang Joe's machine.
