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
- **LIFF Phase 1 (May 2026):** `/liff/orders` opens the same Order Tracking experience as `/m/orders` inside LINE (LIFF SDK + `NEXT_PUBLIC_LINE_LIFF_ID`). No Bot / webhook in this phase — see `LINE_LIFF_SETUP.md`.
- **LINE Inbox + AI:** **`POST /api/line-inbox/analyze`** (read-only suggestions) + **`POST /api/line-inbox/confirm`** (writes after human confirm) + LIFF **`/liff/line-inbox`**. Spec: **`LINE_INBOX_AI_ANALYSIS_PLAN.md`**. **No** auto-save from analyze; **no** secrets in browser.
- **LINE Inbox safety:** mention/tag/person-only and emoji/punctuation-only LINE text is context/noise only; tags are stripped from real work lines before suggestions are saved. When Gemini/Groq is available for `/api/line-inbox/analyze`, AI output is still guarded by deterministic post-processing before any human-confirmed save.
- **LINE Inbox review UI:** normal staff UI shows only the detected car summary and saveable work suggestions. Ignored mention/spec/noise context and raw `car_row_id` stay hidden unless a dev-only debug disclosure is available.
- **LINE Inbox stock/spec matching:** stock number + vehicle spec/model/color/year lines are context for car matching, not order items. If no confident car match is found, staff must manually choose/search a car before save; the UI should not silently use the first/default car.

## Implementation status (as of last repo inspection)

### UX reference (documentation only)
- **`docs/mockups/order-tracking-mobile-mockup.tsx`**: intentional **fake-data** shell to mirror ChatGPT/card layout (**do not import** into App Router). Use when comparing chips, COST panel layout, row structure, filters, collapse behavior. Production **`/m/orders`** stays on **`mobile-order-tracking-home.tsx`** only with Supabase-backed data (plus existing empty-list `ORDERS` fallback).

### Canonical mobile list — `/m/orders` and LIFF — `/liff/orders`
- **Routes:** `src/app/(app)/m/orders/page.tsx` and `src/app/(app)/liff/orders/page.tsx` (dynamic).
- **Shared server loader:** `src/lib/order-tracking/load-order-tracking-page.ts` (same props for both routes).
- **Component:** `src/components/orders/mobile-v2/mobile-order-tracking-home.tsx`.
- **LIFF:** `src/components/liff/liff-orders-shell.tsx` wraps only the `/liff/orders` route (status strip + SDK init).
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
- Issue #9 experiment: `NEXT_PUBLIC_ORDER_CHIP_CACHE_ENABLED=false` is the safe default. When set to `true` on Vercel Preview/Production, `/m/orders` tests chip/count relationship behavior plus filtered card loading without changing schema: full car index for search/filter/counts, lightweight item filter index for staff/item relationships, first 20 matching full card details hydrated initially, and roughly 20 cars kept prepared ahead of the viewport while scrolling through `POST /api/m/order-tracking/card-details`. Rollback is to keep/restore the flag to `false` or close/revert the PR.
- May 2026 performance pass: `/m/orders` keeps the same UI/data/business logic while debouncing vehicle search, reusing memoized filter/count inputs, aggregating sale chip counts in one pass, and grouping card items in one memoized pass.
- RLS: anon reads may be allowed per your policies; **writes** for intake use **service role** on the API route, not the browser anon client.
- Next planning choices:
  1. Persist **card** item status changes (same or new API contract).
  2. Load **real** storage/deposit rows into `OrderCard` instead of `storage: []`.
  3. Replace or align `/m/orders/receive-line` mock with the inline intake + save path.
  4. Unblock `order_storage_items` in PostgREST schema cache and re-run storage QA cases.
