# LINE n8n Dry-Run Plan for Chang Joe

Status: planning and dry run only. Do not change production LINE webhook, do not deploy production, do not apply Supabase migrations, and do not expose secrets.

## Approved Decisions

- ChatGPT Site will continue using the existing Supabase production project.
- Supabase is not being moved.
- The existing Vercel deployment stays as rollback/fallback.
- The production LINE webhook is not changed.
- n8n must not save real data or reply to LINE until explicitly approved.
- n8n will run on Chang Joe's machine first, using Test/Dry Run.
- No token, password, LINE channel secret, access token, or Supabase service role key may be committed.

## Current Repo State Found

The local repo for `pennat-max/dashboard` is `C:\Users\TONY\Documents\Codex\Order  Tracking`.

Built or present:

- `POST /api/line/webhook` exists. It verifies LINE signatures when enabled and stores text messages in `line_inbox_messages`. In the current working tree it is additionally gated by `LINE_WEBHOOK_ENABLED=true`, so it is off by default unless that env is set.
- `POST /api/line-inbox/analyze` exists and is read-only. It calls the shared parser/analyze core and never writes `order_items`.
- `POST /api/line-inbox/confirm` exists and writes only after an authenticated/mutation-authorized confirmation.
- `GET /api/line-inbox/pending-queue` exists and reads pending LINE inbox rows for staff review. The current working tree includes richer grouping, fallback analysis, manual-review states, and attachment metadata display when payloads contain stored attachments.
- `POST /api/line-inbox/pending-save` exists and writes selected queued items through the same persistence layer, after UI/user approval.
- Shared parser and matching code exists under `src/lib/line-inbox/*`: split, car resolve, duplicate hints, fallback analyze, car match status, pending queue view, acknowledgement text helpers, and persistence.
- `line_inbox_messages` migration exists at `supabase/migrations/20260509240000_line_inbox_messages.sql`.
- Copy-ready LINE reply text exists in UI/helper code, but no automatic LINE reply/push call is implemented.

Partial or gated:

- Real LINE webhook operation depends on production env, LINE Developers settings, allowed group IDs, and the `line_inbox_messages` table being available.
- Image/file handling is not a full LINE download pipeline. Current code can display attachment metadata/URLs if they are already present in analyze payloads, but the webhook text path does not download LINE binary content.
- Pending queue fallback analysis can classify rows that have no stored analyze payload, but this is still advisory and should remain dry-run for n8n.
- Auto-save exists only as human-triggered pending save/confirm routes. n8n must not call these while `AUTO_SAVE=false`.

Mock or not wired:

- `/m/orders/receive-line` remains a mock-only receive flow.
- Optional external AI refinement is not wired into the LINE Inbox analyze core.
- Automatic LINE replies, push messages, retry/dead-letter infrastructure, and daily summaries are not built in production code.

Vercel/production behavior:

- Vercel remains the active rollback/fallback surface.
- Existing production behavior must remain unchanged. The plan below uses the current APIs in dry-run mode and avoids changing webhook URLs, Supabase schema, or LINE reply behavior.

## Target Architecture

```text
LINE
-> Webhook verifies signature
-> Save line_inbox_messages
-> Chang Joe n8n pulls pending rows
-> Analyze and match car
-> Send result back to ChatGPT Site API
-> Supabase
-> Reply to LINE later only after approval
```

Phase 0 uses the current Vercel/Site-compatible API surface only:

- Pull: `GET /api/line-inbox/pending-queue?mode=summary`
- Optional dry-run parser call: `POST /api/line-inbox/analyze`
- No save calls while `AUTO_SAVE=false`
- No LINE reply calls while `LINE_REPLY=false`

## Required n8n Defaults

```text
ACTIVE=false
DRY_RUN=true
AUTO_SAVE=false
LINE_REPLY=false
```

These values are encoded in the importable workflow at `docs/line-n8n-chang-joe-dry-run.workflow.json`.

## n8n Workflow Design

1. Trigger

- Start with Manual Trigger on Chang Joe's machine.
- Later add Cron only after dry-run results are reviewed.
- Keep workflow inactive after import.

2. Configuration

- Use placeholder config only:
  - `CHATGPT_SITE_BASE_URL=https://CHATGPT_SITE_HOST.example`
  - `N8N_LINE_BRIDGE_TOKEN=__SET_IN_N8N_CREDENTIALS_ONLY__`
- Do not export real headers, cookies, Supabase keys, LINE secrets, or LINE access tokens.

3. Pull pending messages

- Call `GET {{$json.CHATGPT_SITE_BASE_URL}}/api/line-inbox/pending-queue?mode=summary`.
- Use server-side authentication only, via a future or existing internal token stored as an n8n credential/env var, not in the workflow JSON.
- Treat response as read-only input.

4. Duplicate protection

- Use `inbox_id` and `line_message_id` as idempotency keys.
- Keep an n8n-local execution record or datastore later. For dry run, the workflow only computes keys and does not mark rows confirmed.
- Never call `pending-save` for a row already classified or already saved.

5. Text/image/file handling

- Text rows: pass through existing parser/analyze route or use pending queue payload. Do not duplicate parser logic in n8n.
- Image/file rows: keep as attachment metadata only. If binary download is later added, it must be a separate approved phase with storage and retention rules.
- Image-only messages without car/text anchor go to Human review or Blocked.

6. Reuse existing parser/AI

- n8n should call the app's API instead of reimplementing car matching, split, duplicate detection, or confidence rules.
- Parser source of truth remains `src/lib/line-inbox/*`.

7. Classification buckets

- High confidence:
  - matched car exists,
  - has action lines,
  - `needs_human_review=false`,
  - confidence is acceptable from payload.
- Human review:
  - possible duplicate, unclear item, manual-review flag, matched car with no work, or any attachment requiring staff mapping.
- Blocked:
  - no car record, ambiguous vehicle, missing required fields, API/auth failure, unsupported file, or dry-run validation failure.

8. Retry and error queue

- All HTTP calls have bounded retry.
- Failed rows go to an error item with:
  - idempotency key,
  - endpoint,
  - sanitized error,
  - timestamp,
  - next action.
- No message body should be sent to external logging unless explicitly approved.

9. Health check

- Workflow should verify the app endpoint responds before processing.
- Future endpoint recommendation, if needed: `GET /api/line-inbox/n8n/health`, disabled by default behind a feature flag. Not added in this task.

10. Daily summary future phase

- After approval, add a daily summary of counts only:
  - pending,
  - high confidence,
  - human review,
  - blocked,
  - errors.
- Send summary to approved internal channel only, not LINE customers/groups.

11. Replay failed work

- Replay uses stored idempotency keys.
- Replays must be dry-run until an owner approves write mode.
- Replays must not retry LINE replies unless the reply phase is explicitly approved and idempotent.

## API Notes

No new API endpoint is required for this dry-run plan.

If an n8n-specific API is added later, it must:

- Be disabled by default behind a feature flag, for example `LINE_N8N_API_ENABLED=false`.
- Use server-side authentication only.
- Scope permissions to read pending rows and submit dry-run analysis results only.
- Support idempotency keys.
- Write an audit log for any state-changing request.
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on the server. It must never appear in browser code, n8n exports, logs, or docs.
- Preserve existing production webhook and pending queue behavior.

## Test Workflow File

Import `docs/line-n8n-chang-joe-dry-run.workflow.json` into n8n.

Use `docs/line-n8n-chang-joe-runbook.md` as the step-by-step checklist for Chang Joe's first import and manual dry-run test.

Use `docs/chatgpt-site-cutover-line-n8n-checklist.md` for the ChatGPT Site cutover/rollback smoke checklist while LINE and n8n stay dry-run.

The workflow:

- is inactive,
- starts manually,
- defaults to dry-run,
- fetches pending queue summary,
- keeps HTTP/auth failures in an explicit no-op error queue,
- splits pending messages/groups,
- accepts both `action_lines` and legacy/simple `new_lines` queue payloads,
- classifies each item into `high_confidence`, `human_review`, or `blocked`,
- prepares a dry-run payload for a future ChatGPT Site callback,
- routes real save/reply paths to no-op while `AUTO_SAVE=false` and `LINE_REPLY=false`.

## Opening Real LINE Later Requires Approval

Before enabling real LINE behavior, owners must approve:

- production LINE webhook URL change or confirmation,
- production `LINE_CHANNEL_SECRET`,
- allowed group IDs,
- presence and RLS posture of `line_inbox_messages`,
- any attachment storage table/bucket,
- exact write endpoint and audit policy,
- exact reply text and rate-limit behavior,
- rollback plan to Vercel,
- dry-run evidence from Chang Joe's n8n runs.

## Risks

- Docs drift: some older docs still say webhook/group ingestion is not built, while current source has a partial webhook route.
- Current local working tree has uncommitted LINE-related changes. Do not overwrite them.
- Pending queue behavior depends on the table existing and env being configured.
- Attachment support is metadata/display-level, not full LINE binary ingestion.
- Calling `pending-save` from n8n would create real `order_items`; keep `AUTO_SAVE=false`.
- Calling LINE reply/push would affect real users; keep `LINE_REPLY=false`.
