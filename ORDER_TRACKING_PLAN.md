# ORDER TRACKING PLAN

## Definition
Order Tracking is the module to track:
- parts orders
- accessories
- car modification jobs
- store stock checks
- garage pickup/install work
- customer-requested work

All tracking is linked back to each car in `public.cars` (car master).

## First User Groups
1. Sales
2. Store
3. Garage / Installation

## Main Workflow
Sales creates request -> Store checks stock -> Store orders/receives parts -> Garage picks up parts -> Garage installs -> job done.

## Data Model Plan (Planning Only)
- `public.cars` remains the car master.
- `order_tasks` for main job/request.
- `order_items` for parts/accessories/work items.
- `order_task_updates` for timeline/activity.
- `order_storage_items` for storage/deposit rows per task/car.
- `order_attachments` later for photos/receipts.
- Reference mapping doc: `ORDER_TRACKING_DB_MAPPING.md` (Phase 1 read-only mapping against current repo schema/types/code).

## Mobile-First Rules
- one-hand friendly
- large cards
- large buttons
- sticky bottom actions
- horizontal filter chips
- no wide tables
- no long forms

## LINE Bridge Plan
- Start with copy-ready LINE messages.
- Every order should have a mobile order link.
- Staff can continue chatting in LINE.
- Real status should live in Supabase.
- Do not implement LINE Bot or LIFF until the manual bridge is validated with users.

## Implementation status (as of last repo inspection)

### UX reference (documentation only)
- **`docs/mockups/order-tracking-mobile-mockup.tsx`**: intentional **fake-data** shell to mirror ChatGPT/card layout (**do not import** into App Router). Use when comparing chips, COST panel layout, row structure, filters, collapse behavior. Production **`/m/orders`** stays on **`mobile-order-tracking-home.tsx`** only with Supabase-backed data (plus existing empty-list `ORDERS` fallback).

### Canonical mobile list — `/m/orders`
- **Route:** `src/app/(app)/m/orders/page.tsx` (dynamic).
- **Component:** `src/components/orders/mobile-v2/mobile-order-tracking-home.tsx`.
- **Reads:** `fetchCarsForOrderTracking()` + `fetchOrderItemsByCars()` merge `order_items` onto each car card (keys `row:{row_id}` and `id:{id}`).
- **Fallback:** if no cars returned, UI uses in-file `ORDERS` mock array for demo.
- **Filters:** sale **status** (ทั้งหมด / จอง / รอส่ง / ส่งแล้ว / ว่าง), staff (from data + defaults), item status + counts (**computed from `order.items`**, including demo `ORDERS` when fallback), storage-only toggle, plate keypad + search across plate / full plate / chassis / spec string. **Per-sale name chips (ALL/AOR/…) are not on this screen anymore.**
- **Cards:** cost toggle from `cars` (`total_cost`, repair/doc/expense fields); item status `<select>` persists via **`POST /api/m/order-items/update`**; date picker for **สั่ง** → `order_items.due_date`; **หมายเหตุ** → `order_items.note`; **ฝาก** → storage API; storage block + LINE share when `storage` non-empty from **`fetchOrderStorageByCars`** (requires migrated `order_storage_items`).
- **Cards timeline:** has `ประวัติ` expandable panel from `order_task_updates` (latest-first, compact mobile view, incremental "ดูเพิ่ม").
- **Mode clarity:** explicit real-data mode vs demo fallback mode (no silent blending when `cars` is empty).
- **Card UX:** storage block is collapsible; item rows keep per-row saving indicator and compact error feedback; item row aligns with mock (**responsive** row; date chip **only** when status **สั่ง**; **ฝาก** shows `storage_type` / expiry from DB); **COST** panel: header **สรุปต้นทุน** + always **ค่าอะไหล่/ของแต่ง**; sub-boxes ต้นทุนรวม·ซ่อม·เอกสาร; no vehicle photo inside COST. **Toolbar:** **เพิ่มงาน**, **รอ/จบ** count, **แชร์** only if car has **storage** (LINE สรุปของฝาก); no **Copy สรุป**. Item-status filter has **สถานะรายการ** label; per-status numbers come from **`itemStatusCounts`** (aggregated from `order.items` on the filtered list — real data or in-file demo orders). Collapsed **ดูทั้งหมด** uses strong dashed style; inline intake heading matches LINE-on-card wording.
- **QA checklist:** `ORDER_TRACKING_QA_CHECKLIST.md` tracks pass/fail test cases for real-run verification.
- **Inline “รับงานจาก LINE”:** accordion under a card; shows **real** existing line items for that car; paste/split; duplicate comparison vs existing labels; add row; **บันทึก** calls **`POST /api/m/order-intake/save`** (server, service role). Top bar **+ รับงานจาก LINE** opens full-screen intake without car context (save shows “จากการ์ดรถเท่านั้น” behavior).

### Separate mock page — `/m/orders/receive-line`
- **Still mock-only:** `MobileReceiveLineFlow` + `src/lib/orders/mobile-mock.ts` (`MOCK_MOBILE_ORDERS`).
- Flow: select sale → keypad plate → paste LINE → split / duplicate flags → mock “add” to local state only.

### Detail route
- `/m/orders/[id]` redirects to `/m/orders` (no standalone detail page).

### Writes (current code)
- **Persisted:** intake lines saved through **`/api/m/order-intake/save`** → `order_tasks` (create if missing) + `order_items` insert/update by label.
- **Persisted:** on-card item edits through **`/api/m/order-items/update`** with optimistic UI update (status, assignee, due date, note, item name).
- **Storage flow added:** **`/api/m/order-storage/upsert`** for item status `ฝาก` with lock-once behavior (`store_30_days` or `in_car`), plus optional `order_task_updates` log write.
- **Audit log:** item/storage/intake write APIs now append `order_task_updates` record for each action; currently encoded in `message` text because structured columns are not present yet.

### API / server helpers
- `src/app/api/m/order-intake/save/route.ts`
- `src/app/api/m/order-items/update/route.ts`
- `src/app/api/m/order-storage/upsert/route.ts`
- `src/lib/orders/task-update-log.ts`
- `src/lib/supabase/service-role.ts` (requires `SUPABASE_SERVICE_ROLE_KEY`)

## Phases (adjusted to reality)
- **Phase 1:** Schema / SQL reference in repo (apply in Supabase project separately).
- **Phase 2–3:** Read-only + mobile UX — **partially superseded:** `/m/orders` now reads real car + item rows when available.
- **Phase 4:** Manual LINE copy — partially present on cards; no automated bridge.
- **Phase 5+:** Evidence, Sheet sync, controlled edits, two-way sync — **not done**.

## Notes
- RLS: anon reads may be allowed per your policies; **writes** for intake use **service role** on the API route, not the browser anon client.
- Next planning choices:
  1. Persist **card** item status changes (same or new API contract).
  2. Load **real** storage/deposit rows into `OrderCard` instead of `storage: []`.
  3. Replace or align `/m/orders/receive-line` mock with the inline intake + save path.
  4. Unblock `order_storage_items` in PostgREST schema cache and re-run storage QA cases.
