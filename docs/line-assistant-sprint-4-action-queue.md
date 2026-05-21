# LINE Assistant Sprint 4: Action Queue / รอจัดการ

Issue #40 adds a guarded staff review queue for analyzed LINE inbox messages.

## What Is Implemented

- `/m/orders` LINE Inbox now has a `รอจัดการ` action queue tab.
- Pending analyzed rows from `line_inbox_messages` are grouped by detected `car_row_id` when available.
- Each queue card shows detected car context, source LINE message preview, related captured LINE photos, existing order items for that car, and AI-proposed actions.
- Staff can choose per suggested action:
  - add a new `order_item`
  - merge/update a matched existing `order_item`
  - skip the suggestion
- New suggestions are selected by default only when AI/deterministic duplicate status is `new`.
- Duplicate, possible duplicate, and unclear suggestions are not selected by default.
- Assignee defaults use the existing sale-to-staff mapping when the detected car sale is available.
- Status, assignee, due date, item name, and note remain editable before save.
- `ตามรูป` / `ตามภาพ` suggestions can stage captured LINE photos before approval; selected photos attach only after the human-approved save creates or updates an item.
- Staff can skip an entire pending inbox message, which marks the message as skipped.

## What Is Intentionally Not Implemented

- No automatic save from webhook or analyze-pending.
- No automatic LINE reply.
- No LIFF change.
- No daily summary.
- No notification assistant.
- No `line_action_queue` table.
- No Supabase schema migration.
- No `public.cars` change.

## API Behavior

- `GET /api/line-inbox/pending-queue`
  - reads `line_inbox_messages`
  - returns grouped action queue data plus backward-compatible `messages` / `new_lines`
  - includes existing items and stored LINE attachment metadata from `analyze_payload`
- `POST /api/line-inbox/pending-save`
  - accepts human-selected queue actions
  - supports `create`, `merge`, `skip`, and `skip_all`
  - writes only after staff approval
  - marks the inbox message `confirmed` when saved or `skipped` when skipped

Because Sprint 4 avoids adding a real `line_action_queue` table, workflow status is still message-level. If staff approves only some actions in one message, the whole inbox message is treated as resolved.

## Required Env Names

Server-only:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` or `GROQ_API_KEY` for AI analyze quality

Existing app/Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_CARS_TABLE`

Optional:

- `LINE_ALLOWED_GROUP_IDS`
- `LINE_ACCEPT_DM`
- `LINE_ACCEPT_ROOM`
- `LINE_INBOX_MESSAGES_TABLE`
- `LINE_INBOX_ATTACHMENTS_BUCKET`

## Schema/Storage Setup Status

- Schema: no new schema required.
- Storage: reuses the existing `order-tracking-photos` bucket from Sprint 3.
- Tables reused:
  - `line_inbox_messages`
  - `order_tasks`
  - `order_items`
  - existing order photo tables/routes

## Rollback Plan

Revert the Sprint 4 PR. Existing Sprint 2/Sprint 3 capture and manual paste/analyze flow remain separate from this queue UI and are not schema-dependent.
