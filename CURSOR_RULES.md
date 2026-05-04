# CURSOR RULES

## Project Identity
- This is one existing **VIGO4U OS** project, not multiple projects.
- Work is organized as modules inside the same project:
  - Dashboard
  - Cars
  - Order Tracking
  - Mobile Operations
  - Google Sheet Sync
  - LINE Bridge / LIFF
  - Future Two-way Sync

## Task Mode Tag
- Every task must use one clear mode tag at the top of the task note/summary.
- Recommended tags:
  - `[Dashboard]`
  - `[Cars]`
  - `[OrderTracking]`
  - `[MobileOps]`
  - `[GoogleSheetSync]`
  - `[LINEBridge]`
  - `[TwoWaySync]`
  - `[ProjectOrganization]`

## Required Reading Before Any Task
- Always read:
  - `VIGO4U_HANDOFF.md`
  - `PROJECT_TASKS.md`
- If working on Order Tracking, also read:
  - `ORDER_TRACKING_PLAN.md`

## Dashboard Rules
- Work only on dashboard pages/components when task mode is Dashboard.
- Do not touch `/orders` or `/m/orders`.
- Do not touch order tracking tables.
- Do not change Supabase schema unless explicitly requested.

## Order Tracking Rules
- Use `public.cars` as the car master table.
- Do not put long order/item data directly into `public.cars`.
- Planned tables:
  - `order_tasks`
  - `order_items`
  - `order_task_updates`
  - `order_attachments` (later)
- First users:
  - Sales
  - Store
  - Garage / Installation
- LINE remains the conversation channel first.
- Supabase becomes the central status source.
- Start with a manual LINE copy-message bridge.
- Do not implement LINE Bot/LIFF until the manual bridge works.

## End Of Every Task
- Run `npm run build`.
- Update `VIGO4U_HANDOFF.md`.
- Update `PROJECT_TASKS.md`.
- If Order Tracking changed, update `ORDER_TRACKING_PLAN.md`.
- Provide a final summary including:
  - files changed
  - build result
  - current app state
  - still not built
  - next step
