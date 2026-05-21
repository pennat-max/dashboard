# LINE Bridge Audit

GitHub issue: #14
Audit date: 2026-05-19
Mode: [LINE Bridge]

This document audits the current LINE Inbox / LINE Bot / LINE Bridge status in the existing VIGO4U OS dashboard repository. It is documentation only: no application code, routes, webhook behavior, or Supabase schema were changed.

## Executive Summary

The repo already contains a partial LINE Bridge:

- Manual LINE Inbox analysis and human-confirm save flows are built.
- A text-only LINE Messaging API webhook route exists in code at `POST /api/line/webhook`.
- The webhook verifies LINE signatures and stores inbound text messages in `line_inbox_messages` as pending capture rows.
- The webhook does not reply to LINE, does not create `order_items` directly, and does not process images/attachments.
- Human review remains the safety gate before any write to `order_items`.
- LIFF Phase 1 exists for `/liff/orders`, and a separate `/liff/line-inbox` manual review UI exists.

Operationally, the webhook is still partial until the production environment, LINE Developers webhook URL, allowed group IDs, and `line_inbox_messages` table are confirmed in the real deployment.

## Current Status Matrix

| Area | Status | Notes |
| --- | --- | --- |
| Manual paste analyze | Built | `POST /api/line-inbox/analyze` returns suggestions and never writes `order_items`. |
| Human confirm save | Built | `POST /api/line-inbox/confirm` writes only after user confirmation. |
| Pending queue from LINE messages | Built/partial | Webhook capture leaves rows as `analyze_status = pending`; `POST /api/line-inbox/analyze-pending` can analyze them into review-ready payloads. |
| Save selected pending queue items | Built/partial | `POST /api/line-inbox/pending-save` saves selected `new` lines and marks the inbox message confirmed. |
| `/m/orders` LINE Inbox toolbar | Built | `line-inbox-ai-toolbar.tsx` supports manual paste and pending queue review. |
| `/liff/line-inbox` | Built | Standalone LIFF/manual review UI for analyze then confirm. |
| `/liff/orders` | Built | Thin LIFF wrapper around the same Order Tracking UI as `/m/orders`. |
| LINE webhook endpoint | Built/partial | `POST /api/line/webhook` exists, but real operation depends on LINE and production env setup. |
| Signature verification | Built | Uses HMAC SHA256 in `verify-line-signature.ts`. |
| Group capture allow-list | Built/partial | Group messages require `LINE_ALLOWED_GROUP_IDS`; discovery logging exists behind `LINE_WEBHOOK_LOG_GROUP_IDS=true`. |
| Direct message capture | Built/partial | Disabled by default; enabled only with `LINE_ACCEPT_DM=true`. |
| Room capture | Built/partial | Disabled by default; enabled only with `LINE_ACCEPT_ROOM=true`. |
| Text message storage | Built/partial | Inserts into `line_inbox_messages`; depends on migration/table being applied. |
| Duplicate detection | Built | Analyze compares against existing items for the resolved car. |
| Order item creation from LINE | Built with human gate | Only confirm/pending-save routes create or merge `order_items`. Webhook does not. |
| Automatic LINE reply | Missing | No current call to LINE reply/push APIs. |
| Copy-ready reply text | Built/partial | Copy/share helpers exist for order messages, but not automatic LINE replies. |
| Image/file attachment ingestion | Missing | Analyze accepts attachment metadata count only; no file download/storage pipeline. |
| `order_attachments` table use | Missing/future | Planning docs mention it later; no implemented attachment persistence found. |
| Full LINE Bot workflow | Missing | No automated reply, rich menu, command handling, or two-way bot workflow is built. |

## Files Reviewed

| Path | Purpose |
| --- | --- |
| `src/app/api/line/webhook/route.ts` | LINE webhook ingestion for text messages. |
| `src/lib/line/verify-line-signature.ts` | LINE signature verification helper. |
| `src/lib/line-inbox/line-inbox-messages.ts` | Insert/update helpers for `line_inbox_messages`. |
| `supabase/migrations/20260509240000_line_inbox_messages.sql` | Migration for the inbound LINE message queue table. |
| `src/app/api/line-inbox/analyze/route.ts` | Read-only analyze endpoint. |
| `src/app/api/line-inbox/confirm/route.ts` | Human-confirm save endpoint. |
| `src/app/api/line-inbox/analyze-pending/route.ts` | Batch analyzer for pending webhook captures; does not create order items. |
| `src/app/api/line-inbox/pending-queue/route.ts` | Pending queue reader for analyzed webhook messages. |
| `src/app/api/line-inbox/pending-save/route.ts` | Save selected queued suggestions after review. |
| `src/lib/line-inbox/run-analyze-core.ts` | Shared deterministic analyze pipeline. |
| `src/lib/line-inbox/persist-line-inbox-confirm.ts` | Shared persistence for confirmed LINE suggestions. |
| `src/components/orders/mobile-v2/line-inbox-ai-toolbar.tsx` | `/m/orders` toolbar for paste/review/pending queue. |
| `src/components/liff/line-inbox-client.tsx` | LIFF/manual LINE Inbox client UI. |
| `src/app/(app)/liff/line-inbox/page.tsx` | `/liff/line-inbox` route. |
| `src/app/(app)/liff/orders/page.tsx` | `/liff/orders` route. |
| `src/components/liff/liff-orders-shell.tsx` | LIFF SDK wrapper and status strip. |
| `src/lib/line/order-tracking-share-url.ts` | LIFF-aware order tracking share URL helper. |
| `src/lib/orders/line-message.ts` | Copy-ready LINE message body helpers. |
| `src/components/orders/mobile/line-copy-button.tsx` | Clipboard copy button for LINE messages. |
| `src/app/api/m/urgent-line/ai-preview/route.ts` | Adjacent urgent LINE AI preview helper; not the webhook bridge. |
| `LINE_INBOX_AI_ANALYSIS_PLAN.md` | Original design/safety plan. |
| `LINE_LIFF_SETUP.md` | LIFF setup notes; now partly stale about webhook status. |
| `VIGO4U_HANDOFF.md`, `PROJECT_TASKS.md`, `ORDER_TRACKING_PLAN.md`, `CURSOR_RULES.md` | Required project scope and guardrails. |

## Workflow Audit

### 1. Manual Paste Flow

Status: built.

Users can paste LINE text into the `/m/orders` toolbar or `/liff/line-inbox`. The analyze endpoint returns suggested work items, duplicate hints, car resolution, and human-review flags. It does not write `order_items`.

### 2. AI / Analyze Behavior

Status: built as deterministic heuristics for LINE Inbox.

The core LINE Inbox analyze path is deterministic:

- Splits pasted text into candidate work lines. Webhook text capture no longer runs analyze inline.
- Resolves a car from `car_row_id`, `car_id`, plate text, or chassis text.
- Loads existing `order_items` for the resolved car.
- Produces duplicate status: `new`, `duplicate`, `possible_duplicate`, or `unclear`.

The adjacent urgent intake endpoint uses `GEMINI_API_KEY`, but that is separate from the LINE Inbox webhook/analyze core.

### 3. Pending Queue

Status: built/partial.

Webhook-ingested messages can appear in the pending queue when:

- `line_inbox_messages` exists.
- Webhook messages are inserted successfully.
- Analyze status is `ok` after `POST /api/line-inbox/analyze-pending` or a future worker runs.
- Workflow status remains `pending`.
- At least one suggested line has `duplicate_status = "new"`.

The toolbar polls the queue and lets staff select which new lines to save.

### 4. Save Suggestions Into `order_items`

Status: built with human review.

Confirmed rows are persisted through `persistLineInboxConfirmations`. The code can create or merge `order_items`, create an order task if needed, and write an audit trail to `order_task_updates`.

Webhook ingestion itself does not create or merge `order_items`.

### 5. Duplicate Detection

Status: built.

Duplicate detection compares normalized candidate lines with existing order items for the resolved car. Unclear or possible duplicates are flagged for human review.

### 6. Copy-Ready Reply

Status: built/partial.

The repo has copy-ready LINE message builders and copy buttons for order/task messages. There is no automatic reply to LINE from webhook messages.

## Webhook Audit

Route: `POST /api/line/webhook`

Built capabilities:

- Reads raw request body.
- Verifies `X-Line-Signature` using `LINE_CHANNEL_SECRET`.
- Accepts text message events only.
- Supports group, user DM, and room sources with env gates.
- Inserts inbound text into `line_inbox_messages`.
- Leaves `analyze_status = "pending"` and `workflow_status = "pending"` for later human/analyze workflow.
- Ignores duplicate LINE message IDs.
- Returns `OK` after processing.

Pending analyze capabilities:

- `POST /api/line-inbox/analyze-pending` processes a limited batch of pending rows.
- It uses the shared read-only LINE Inbox analyze core.
- It updates only analyze fields on `line_inbox_messages`.
- It does not create `order_items`, confirm workflow rows, or reply to LINE.

Not built:

- Automatic LINE reply.
- Push messages.
- Rich menu handling.
- Image/file download.
- Sticker/non-text handling.
- Background retry queue.
- Direct `order_items` write from webhook.

Operational notes:

- If `LINE_CHANNEL_SECRET` is missing, the route logs an error and returns `OK` so LINE will not retry.
- Group messages are skipped unless `LINE_ALLOWED_GROUP_IDS` is configured.
- `LINE_WEBHOOK_LOG_GROUP_IDS=true` can help discover a group ID, but should be temporary.
- Analyze no longer runs inline during the webhook request. `POST /api/line-inbox/analyze-pending` can turn pending captures into review-ready suggestions; a scheduled/background worker is still future.

## Database / Table Status

### `line_inbox_messages`

Status: schema migration exists.

Migration file: `supabase/migrations/20260509240000_line_inbox_messages.sql`

Important fields:

- `line_message_id` unique for duplicate protection.
- `source_type`, `group_id`, `user_id`, `raw_text`, `reply_token`.
- `analyze_status`, `analyze_error`, `analyze_payload`, `needs_human_review`.
- `workflow_status` for pending/confirmed/skipped.
- `car_row_id` for resolved car linkage.

Runtime table name can be overridden with `LINE_INBOX_MESSAGES_TABLE`; default is `line_inbox_messages`.

### Attachments

Status: missing/future.

Planning docs mention future `order_attachments`, but no implemented attachment persistence or LINE attachment download pipeline was found. Current analyze code only accepts an attachment metadata count.

## Environment Names Only

Do not expose the values of these variables.

Currently used by LINE Bridge / adjacent flows:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LINE_CHANNEL_SECRET`
- `LINE_ALLOWED_GROUP_IDS`
- `LINE_WEBHOOK_LOG_GROUP_IDS`
- `LINE_ACCEPT_DM`
- `LINE_ACCEPT_ROOM`
- `LINE_INBOX_MESSAGES_TABLE`
- `NEXT_PUBLIC_LINE_LIFF_ID`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODELS`
- `GROQ_API_KEY`
- `GROQ_MODEL`

Future/expected for automatic replies, but no current usage was found in the webhook code:

- `LINE_CHANNEL_ACCESS_TOKEN`

## Safety Model

The current safety model is correct for Phase 1:

1. Webhook may store text; analyze paths may later generate suggestions.
2. AI/deterministic analysis is advisory only.
3. `order_items` writes happen only through authenticated/mutation-authorized confirm flows.
4. Humans choose create, merge, or skip before saving.
5. Webhook should not create `order_items` directly.
6. Server secrets remain server-only; no LINE or Supabase service secrets are exposed to the browser.

## Mismatches / Documentation Drift

Some handoff/setup docs still say LINE webhook/group ingest is not built. Current source code shows that a webhook route now exists. The accurate state is:

- Webhook code exists.
- Real production readiness still depends on env setup, LINE Developers configuration, allowed group IDs, and the `line_inbox_messages` table.
- The webhook is capture-only, not a full bot.

## Missing Pieces For Real LINE Group Capture

Before this can be called fully production-ready, verify or build:

1. LINE Developers webhook URL points to production `/api/line/webhook`.
2. `LINE_CHANNEL_SECRET` is set in production.
3. Allowed group IDs are discovered and stored in `LINE_ALLOWED_GROUP_IDS`.
4. `line_inbox_messages` exists in the production Supabase database.
5. A test group message appears in `line_inbox_messages` with pending workflow/analyze status.
6. Webhook errors are observable without exposing message contents or secrets.
7. A scheduled/background analyzer is defined for pending captures, with retry or dead-letter handling for failed analyze/save steps.
8. Attachment/image strategy is designed separately.
9. Reply/push strategy is designed separately and gated by human review.

## Recommended Phased Next Steps

1. **Ops verification only:** confirm production env, LINE Developers webhook URL, allowed group IDs, and table readiness using a test LINE group.
2. **Queue/analyze worker:** optionally schedule `line_inbox_messages` pending analysis outside manual/API invocation, with retry/error visibility.
3. **Pending queue UX:** add clearer admin indicators for table missing, env missing, no allowed group, and analyze errors.
4. **Reply draft phase:** generate copy-ready replies from saved suggestions, still requiring human copy/send.
5. **Automatic reply phase:** only after review, add reply/push behavior using `LINE_CHANNEL_ACCESS_TOKEN`; never auto-create order items from bot text.
6. **Attachment phase:** design and approve `order_attachments` before downloading/storing LINE images/files.
7. **LIFF refinement:** tighten `/liff/line-inbox` around the real staff workflow after webhook capture is verified.

## Audit Result

Built:

- Manual LINE Inbox analysis.
- Human-confirm create/merge flow.
- Pending queue APIs, including pending capture analyze.
- Text-only webhook capture code.
- LIFF wrappers and manual review UI.
- Duplicate detection and audit logging.

Partial:

- Real LINE group capture readiness.
- Pending queue operations in production.
- Copy-ready reply workflow.
- AI refinement beyond deterministic LINE Inbox heuristics.

Missing:

- Full bot reply/push workflow.
- Automatic LINE replies.
- Image/file attachment ingestion.
- Attachment persistence.
- Background retry/dead-letter processing.
- Production ops checklist for webhook verification.

