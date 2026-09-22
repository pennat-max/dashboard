# ChatGPT Site Cutover Checklist for LINE and n8n

Status: preparation only. Do not change production LINE webhook, do not activate n8n schedule, do not enable auto-save, and do not apply Supabase migrations from this checklist.

## Ground Rules

- ChatGPT Site uses the existing Supabase production project.
- Supabase is not moved.
- Existing Vercel deployment remains the fallback.
- LINE production webhook remains unchanged until owner approval.
- n8n remains inactive/manual dry-run until owner approval.
- No secrets are committed, exported, pasted into screenshots, or written into workflow JSON.

## Before Cutover

Confirm these items before treating ChatGPT Site as ready:

- ChatGPT Site build/deploy is complete.
- ChatGPT Site env names are present for Supabase reads/writes, without exposing values.
- Existing Supabase production tables are unchanged.
- Existing Vercel app is still reachable as rollback.
- PR `https://github.com/pennat-max/dashboard/pull/112` has the latest workflow v2:
  - `docs/line-n8n-chang-joe-dry-run.workflow.json`
  - `docs/line-n8n-chang-joe-plan.md`
  - `docs/line-n8n-chang-joe-runbook.md`
- n8n workflow defaults remain:

```text
active=false
DRY_RUN=true
AUTO_SAVE=false
LINE_REPLY=false
```

## Cutover Smoke Tests

Run these against the ChatGPT Site URL first. Do not change LINE Developers settings yet.

### Pages

- `/m/orders` opens.
- `/liff/orders` opens.
- `/liff/line-inbox` opens.
- Main dashboard still opens if included in the Site deployment.

### LINE Inbox APIs

- `GET /api/line-inbox/pending-queue?mode=summary`
  - Expected: returns JSON or an authorized error that n8n v2 can route to `HTTP Error Queue No-Op`.
  - Not acceptable: HTML error page, redirect loop, or secret leak.
- `POST /api/line-inbox/analyze`
  - Expected: still requires existing mutation/auth gate.
  - Expected: read-only suggestions only.
- `POST /api/line-inbox/confirm`
  - Do not call during smoke unless a human-approved test payload and rollback record exist.
- `POST /api/line-inbox/pending-save`
  - Do not call during smoke.

### n8n Dry Run

- Import workflow v2 only if it is still inactive.
- Manual-run once only.
- Confirm:
  - pending queue request completes or routes to `HTTP Error Queue No-Op`,
  - `action_lines` and `new_lines` both normalize if present,
  - HTTP failures are visible after retry,
  - no save route is called,
  - no LINE reply route is called,
  - no schedule is activated.

## Rollback Plan

Rollback remains simple because Supabase and LINE production are not changed.

If ChatGPT Site has an issue:

1. Keep LINE webhook production unchanged.
2. Keep n8n inactive.
3. Send operators back to the existing Vercel URL.
4. Capture the failed ChatGPT Site URL, timestamp, route, and sanitized error.
5. Fix Site deployment or env mapping.
6. Re-run smoke tests before trying again.

Do not roll back by:

- changing Supabase data,
- applying migrations,
- force-pushing branches,
- restarting Hermes,
- enabling n8n writes,
- changing LINE webhook URL under pressure.

## Owner Approval Required Before Opening Real LINE

The owner must explicitly approve all of these before real LINE automation:

- Production LINE webhook URL change or confirmation.
- `LINE_CHANNEL_SECRET` and allowed group IDs in production environment.
- n8n server-side auth method.
- n8n schedule activation.
- `AUTO_SAVE=true`.
- `LINE_REPLY=true`.
- Any call to `pending-save` or `confirm` from n8n.
- Attachment download/storage design.
- Reply text and rate-limit policy.
- Audit log destination and retention.
- Rollback owner and rollback trigger.

## Ready/Not Ready Decision

Ready for ChatGPT Site cutover when:

- ChatGPT Site pages smoke-test OK.
- Supabase production reads work.
- Existing Vercel fallback remains reachable.
- n8n v2 dry-run either succeeds or fails into the explicit no-op error branch.
- No production LINE change has been made.
- No real save/reply has occurred.

Not ready when:

- Site routes redirect unexpectedly.
- Pending queue returns HTML or leaked diagnostic output.
- n8n workflow is active by accident.
- Workflow contains real secrets.
- Workflow calls save/reply routes.
- Provider quota/rate-limit prevents Hermes/Chang Joe from reporting dry-run status.

