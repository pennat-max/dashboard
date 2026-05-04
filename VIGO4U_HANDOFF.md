# VIGO4U HANDOFF

## Current Goal
- Operate and refine a read-only used-car dashboard for operational tracking.
- **Order Tracking (mobile):** primary UI is at `/m/orders`, backed by real `cars` + `order_tasks` / `order_items` reads when Supabase is configured; list still falls back to in-file mock orders when no cars are returned. Inline “รับงานจาก LINE” flow can **persist new/updated items** via a server API (service role). `/m/orders/receive-line` remains a **separate mock-only** flow.

## Current Tech Stack
- **Framework:** Next.js 14 (`next@14.2.35`) with App Router.
- **Language:** TypeScript.
- **Runtime UI:** React 18.
- **Package manager:** npm.
- **Styling/UI:** Tailwind CSS v4, shadcn UI, Base UI, Lucide icons.
- **Charts:** Recharts.
- **Data client:** Supabase JS (`@supabase/supabase-js`) and SSR helper package (`@supabase/ssr`).
- **i18n approach:** dictionary files (`th`/`en`) + locale helper.

## Current Files (Order Tracking — verified)
- **`docs/mockups/order-tracking-mobile-mockup.tsx`** — **REFERENCE ONLY**: ChatGPT-style UX mock (`OrderTrackingMobileMockupReference`; fake data banner). Not imported by routes; compare against real UI when iterating layout.
- `src/app/(app)/m/orders/page.tsx` — server page: `fetchCarsForOrderTracking()` + `fetchOrderItemsByCars(cars)` → `MobileOrderTrackingHome`.
- `src/components/orders/mobile-v2/mobile-order-tracking-home.tsx` — main mobile Order Tracking UI (filters, cards, inline intake, save).
- `src/lib/data/cars.ts` — includes `fetchCarsForOrderTracking()` for `/m/orders` car list.
- `src/lib/data/orders.ts` — read helpers including `fetchOrderItemsByCars` (joins tasks + items per car).
- `src/lib/supabase/anon.ts` — anon client (reads).
- `src/lib/supabase/service-role.ts` — **server-only** client using `SUPABASE_SERVICE_ROLE_KEY` (used by intake save API).
- `src/app/api/m/order-intake/save/route.ts` — **POST** saves intake lines to `order_items` (creates `order_tasks` row if none) via service role.
- `src/app/(app)/m/orders/receive-line/page.tsx` + `src/components/orders/mobile-v2/mobile-receive-line-flow.tsx` — **mock-only** receive flow (`MOCK_MOBILE_ORDERS` from `src/lib/orders/mobile-mock.ts`).
- `src/app/(app)/m/orders/[id]/page.tsx` — redirects to `/m/orders`.
- `src/app/(app)/m/orders/page.old.tsx`, `[id]/page.old.tsx` — backups of earlier read-only mobile pages.
- `src/types/order.ts`, `src/lib/order-fields.ts` — order domain types/helpers (used by other order read paths).
- `supabase/schema.sql`, `supabase/policy-anon-select.sql` — SQL reference (not auto-applied by app).

## Current Supabase Setup
- **Connected:** Yes for dashboard and for `/m/orders` when env + tables exist.
- **Env vars used (reads):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SUPABASE_CARS_TABLE` (optional; defaults to `cars`)
- **Env var used (intake save API only):**
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only; **never** `NEXT_PUBLIC_`)
- **Client behavior (`createAnonClient`):** anonymous read client, `no-store` fetch, no session persistence.
- **Tables referenced by mobile Order Tracking reads:** `cars` (or override), `order_tasks`, `order_items` (via `fetchOrderItemsByCars`).
- **Migrations framework:** SQL reference files under `supabase/` (manual apply in Dashboard). **Supabase CLI** is now installed as a dev dependency (`supabase@^2.98.0`) with `supabase/config.toml` from `npx supabase init --yes` for local tooling defaults only.
- **Supabase CLI:** run via `npx supabase <command>` (e.g. `npx supabase --version`). **Remote project is not linked** in this repo session — obtain **project ref** from Supabase Dashboard (Project Settings → General → Reference ID) or parse from `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`), then run `npx supabase login` + `npx supabase link --project-ref <ref>` when ready. Do not guess the ref; avoid `db push` / migration apply until explicitly approved.

## Current Google Sheet Setup
- No direct Google Sheets API integration in repo.
- No sync job/route for sheets.

## Current Data Flow — `/m/orders`
1. Server: `fetchCarsForOrderTracking()` → list of `Car` rows from Supabase (or empty on error / missing config).
2. Server: `fetchOrderItemsByCars(cars)` → `order_items` grouped by car keys `row:…` / `id:…` (graceful if tables missing).
3. Client `MobileOrderTrackingHome`: maps each car to an “order” card via `toOrderFromCar` + merged items from step 2.
4. If `carsData.length === 0`, UI uses hardcoded `ORDERS` mock array in `mobile-order-tracking-home.tsx` (demo fallback).

## Current Data Flow — intake save
1. User expands inline intake on a card and clicks **บันทึก**.
2. Browser **POST** `/api/m/order-intake/save` with `car_row_id` / `car_id`, plate label, and line items.
3. Route uses **service role** to resolve or create `order_tasks` and upsert `order_items` by label match.

## Existing Pages
- `/` → `/dashboard`
- `/dashboard` and sub-routes (statuses, booked, exported, etc.)
- `/cars`, `/cars/[id]`
- **`/m/orders`** — main Order Tracking mobile UI (real reads + mock fallback).
- **`/m/orders/receive-line`** — separate mock receive flow (not wired to Supabase).
- `/m/orders/[id]` → redirect to `/m/orders`

## Existing Functions / API Routes
- **API routes:** `POST /api/m/order-intake/save` (`src/app/api/m/order-intake/save/route.ts`).
- **Read functions:** `fetchCarsForOrderTracking`, `fetchOrderItemsByCars`, `fetchMobileOrders`, `fetchMobileOrderDetail`, dashboard car helpers in `cars.ts`.

## Current Problems / Caveats
- **RLS:** Anonymous client cannot insert `order_tasks`; saving relies on **service role** on the API route. Missing `SUPABASE_SERVICE_ROLE_KEY` → save fails at runtime.
- **Two receive flows:** Full-page `+ รับงานจาก LINE` opens `Intake` with no car context (save disabled message); inline/Chevron on a card opens intake for that car with save enabled.
- **PostgREST / schema:** If `order_storage_items` (or patch SQL) is not applied, storage read/save can still error until the table matches the API.

## Working Features (Order Tracking mobile — snapshot)
- Filters: sale **status** chips (ทั้งหมด / จอง / รอส่ง / ส่งแล้ว / ว่าง), staff (dynamic from `assignee_staff` + defaults), item status filter (**label** “สถานะรายการ”) + **per-status counts from `order.items`** on the filtered scope (no hardcoded demo matrix), storage-only toggle (counts all cars’ empty storage today), plate keypad + text match on plate/fullPlate/chassis/spec.
- **Sale name chips (ALL / AOR / …)** removed from this screen; sale name still shown on card from `sale_support` when using real cars.
- Order cards: plate + `spec` + optional model year + chassis, sale/buyer/price; **ship** badge from `booked_shipping` only; **COST** expand: dark header **สรุปต้นทุน** + always-visible **ค่าอะไหล่/ของแต่ง** (active link from `part_accessories` URL or disabled-style when no link), sub-boxes **ต้นทุนรวม** / **ซ่อม** / **เอกสาร** (no car image inside panel); `part_accessories` link; item rows persist via API (**row layout**: stack on narrow, row on `sm+`; date chip only when **สั่ง**; **ฝาก** row shows label from `order_storage_items.storage_type`); **completed** (`จบ`) hidden until **ดูทั้งหมด**; storage + timeline when DB returns data.
- **Toolbar (card):** **เพิ่มงาน** · **รอ/จบ** count · **แชร์** only when the car has **storage** rows (LINE share text = สรุปของฝาก). No **Copy สรุป** button. **ดูฝาก** / **ประวัติ** remain in the secondary row when applicable.
- Infinite-style paging for visible list.
- Inline expand: “งานเดิมของรถคันนี้” = **real** `order_items` for that car; paste/split/compare; **เพิ่มรายการ** + **บันทึก** (API). Inline LINE block titled **รับงานจาก LINE · รถคันนี้เท่านั้น** (no mock data wired here).

## Not Yet Built / Partial
- `/m/orders/receive-line` not connected to real cars or DB.
- No LINE Bot / LIFF; no real LINE webhook bridge.
- No Google Sheet sync in repo.
- Structured `order_task_updates` columns (draft SQL only); runtime still message-encoded.

## Important Decisions
- Dashboard remains read-first; Order Tracking mobile now has a **controlled** write path for intake lines only (service role API).
- Anon key remains for broad reads; privileged writes isolated to server route + secret env.

## Next Recommended Step
- Optionally polish remaining mockup deltas (toolbar copy vs mock, COST panel typography) strictly as presentation — still no mock DB rows on `/m/orders` when cars exist.
- Decide product-wise: either persist **card** status edits to `order_items` (same API, extended contract) or keep card read-only until review.
- Wire **storage** rows if `order_storage_items` (or equivalent) exists; align mapper with schema.
- Either deprecate `/m/orders/receive-line` mock in favor of inline flow, or rewire it to the same API + real car lookup.

## Latest Update
- **[OrderTracking filters — May 2026]** Removed hardcoded **`STATUS_COUNTS`** from **`mobile-order-tracking-home.tsx`**. Item-status chip counts always use **`itemStatusCounts`** derived from **`mappedOrders.items`** (Supabase path or demo **`ORDERS`** fallback). Same filter dimensions as before (sale, sale-status, vehicle search, storage-only, staff). No API/schema change.
- **[OrderTracking UX — pass 2 — May 2026]** `/m/orders` only: **COST** header matches mock (always **ค่าอะไหล่/ของแต่ง** control; sub-panels ต้นทุนรวม/ซ่อม/เอกสาร); **แชร์** in card toolbar only when `storage.length > 0`; removed **Copy สรุป**; item row: date chip only for **สั่ง**; **ฝาก** chip uses `depositStorageChipLabel` from DB `storage_type` + `expire_date`; larger touch targets on assignee/status `<select>`; **ดูทั้งหมด** stronger dashed style. No API/schema/dashboard/cars changes. **`npm run build`** OK.
- **[OrderTracking UX — May 2026]** Added **`docs/mockups/order-tracking-mobile-mockup.tsx`** as a **standalone reference** (not routed). Earlier iteration: item row `flex-col`/`sm:flex-row`; filter label **สถานะรายการ**; inline LINE caption; **ดูทั้งหมด** collapsed style. (Pass 2 refines date chip to **สั่ง** only — see bullet above.)
- **[OrderTracking]** Aligned `/m/orders` card mapping with `ORDER_TRACKING_DB_MAPPING.md` / mockup field guide: header uses `plate_number` + `spec` + `model_year`/`c_year` + `chassis_number`; sale/buyer/`sale_price_usd`; **ship** badge = `booked_shipping` only; cost = `total_cost` (fallback buy-price line); document line = `document_status` · `initial_document` · `doc_fee` (added to `CARS_SELECT_ORDER_TRACKING`); expense link = `part_accessories`. No mock `ORDERS` mixed into real mode; keys remain `row_id` / `id` (not plate). No schema change.
- **[ProjectOrganization]** Installed Supabase CLI as dev dependency (`npm install supabase --save-dev`), verified `npx supabase --version`, ran `npx supabase init --yes` (added `supabase/config.toml` + `supabase/.gitignore`). Did **not** run migrations, `db push`, `db reset`, or `supabase start`; remote project **not** linked (no `supabase link`).
- Added `ORDER_TRACKING_DB_MAPPING.md` for Phase 1 database mapping/documentation only.
- Mapping is based on repo truth (`supabase/schema.sql`, `src/types/car.ts`, `src/lib/data/cars.ts`, `src/lib/car-fields.ts`, env examples).
- No app feature implementation, no schema edits, no migration execution in this update.
- Added `POST /api/m/order-items/update` for card-level item edits in `/m/orders`.
- `OrderCard` now performs optimistic save for item name/status/assignee/due date/note and shows inline error when save fails.
- `fetchOrderItemsByCars` now carries item identity (`id`, `order_task_id`) and optional `due_date`/`note` when available.
- Added `POST /api/m/order-storage/upsert` and storage read helper `fetchOrderStorageByCars`.
- `/m/orders` now requests storage rows and maps to card `storage`, including `storageLate` based on `expire_date < today` with active status.
- Card `ฝาก` flow now shows `Store 1 เดือน` / `ไปกับรถ`, saves through API, and locks after first selection in normal UI.
- Added draft SQL file `supabase/order-storage-items-draft.sql` for schema planning only (not applied).
- Added audit helper `src/lib/orders/task-update-log.ts` and wired audit logs to:
  - `POST /api/m/order-items/update`
  - `POST /api/m/order-storage/upsert`
  - `POST /api/m/order-intake/save`
- Current `order_task_updates` schema in runtime only supports `role` + `message`; action metadata is encoded in `message` text for now.
- Added draft SQL `supabase/order-task-updates-audit-draft.sql` for structured columns (not applied).
- Added timeline read helper `fetchOrderUpdatesByCars` and wired `/m/orders` to load updates per car/task.
- `OrderCard` now includes `ประวัติ` expandable timeline (action label, old->new, note, updated_by, created_at) with latest-first and `ดูเพิ่ม`.
- `/m/orders` now has clearer runtime state separation:
  - real mode from `public.cars` when data exists
  - demo fallback mode banner when cars result is empty
  - data warning banner when any read helper returns error text
- Card UX tightened for QA readiness:
  - storage section is collapsible (`ดูฝาก` / `ซ่อนฝาก`)
  - timeline and cost remain collapsible
  - item row keeps per-row saving indicators and save error feedback
- Added `ORDER_TRACKING_QA_CHECKLIST.md` with step-by-step QA matrix and pass/fail status.
- Latest QA run:
  - Build and item/timeline flows pass
  - storage/deposit flow is still blocked by `order_storage_items` missing from PostgREST schema cache in runtime
