# LINE Assistant Sprint 3: Image Capture Setup

Issue #38 adds a guarded capture path for LINE image/file messages.

## What is implemented

- `POST /api/line/webhook` still verifies `X-Line-Signature`.
- Text messages keep the Sprint 2 behavior: capture into `line_inbox_messages` only.
- LINE `image` and image-like `file` messages are captured as inbox rows with no auto-save and no auto-reply.
- The server downloads LINE content with `LINE_CHANNEL_ACCESS_TOKEN`.
- Image bytes are uploaded to Supabase Storage.
- Attachment metadata is stored inside `line_inbox_messages.analyze_payload.line_attachments`.
- `/m/orders` LINE Inbox review can show recent captured LINE photos in the item photo picker.
- Staff can select captured LINE photos for a suggested item; the photo is attached to the created order item only after human approval/save.
- Pending queue rows that contain `ตามรูป` / `ตามภาพ` can stage recent LINE photos before save. `pending-save` returns saved item IDs so staged images can be attached immediately after the human save action.

## What is intentionally not implemented

- No LINE auto-reply.
- No order item creation from webhook or analyze-pending.
- No LIFF change.
- No daily summary.
- No notification assistant.
- No schema migration applied by this PR.

## Required env names

Server-only:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`

Existing app/Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_CARS_TABLE`

Optional:

- `LINE_ALLOWED_GROUP_IDS`
- `LINE_ACCEPT_DM`
- `LINE_ACCEPT_ROOM`
- `LINE_INBOX_MESSAGES_TABLE`
- `LINE_INBOX_ATTACHMENTS_BUCKET` (default: `order-tracking-photos`)

## Storage/schema setup status

This sprint does not require a new attachment table. It reuses:

- `public.line_inbox_messages` for inbox rows and attachment metadata in `analyze_payload`.
- Supabase Storage bucket `order-tracking-photos`.
- Existing `public.order_tracking_photos` only when a human saves an item and attaches selected LINE photos to that order item.

If the production database does not yet have the order photo setup, apply the already-existing project setup file:

Copy the SQL from `supabase/order-tracking-photos.sql` into Supabase SQL Editor and run it if order item photos are not available yet. This is an existing project setup file, not a new Sprint 3 schema.

If the storage bucket is missing, create it as public with image MIME support:

- Bucket: `order-tracking-photos`
- Public: `true`
- Intended content: `image/*`

The webhook does not create buckets automatically. If storage is missing, it records a guarded capture error on the inbox row and returns `OK` to LINE so LINE does not retry indefinitely.

## Webhook URL

Production:

```text
https://used-car-export-dashboard.vercel.app/api/line/webhook
```
