# ORDER TRACKING DB MAPPING (Phase 1, Read-only)

Task mode: `[OrderTracking]`

## Scope / Guardrails
- This document is mapping and planning only.
- No schema change, no migration, no write-flow implementation in this phase.
- Dashboard and Google Sheet sync behavior are untouched.

## Data Sources Used
1. `supabase/schema.sql`
2. `src/types/car.ts`
3. `src/lib/data/cars.ts`
4. `src/lib/car-fields.ts`
5. `.env.example`, `env.example`

## Environment / Connection Check
- Repository has `.env.example` and `env.example`.
- Local runtime has `.env.local` (confirmed from build/runtime).
- Live Supabase read test is available (`cars` query works).
- Direct `information_schema.columns` read via PostgREST is not exposed in schema cache in this project, so data type/nullable metadata cannot be fetched directly through current API access path.
- Current mapping uses:
  - live `cars` column name discovery from sample row keys, and
  - repo files above for meaning and expected usage.

## A) Current Supabase Reality

### A.1 Tables confirmed in repo
- `public.cars` is explicitly defined in `supabase/schema.sql` (baseline reference schema).
- Code also reads:
  - `order_tasks`
  - `order_items`
  - `order_task_updates`
  via `src/lib/data/orders.ts` (with graceful handling when tables are missing).

### A.2 `public.cars` columns actually used by app for Order Tracking
From `CARS_SELECT_ORDER_TRACKING` in `src/lib/data/cars.ts`:
- `id`
- `row_id`
- `spec`
- `sale_support`
- `buyer`
- `sale_price_usd`
- `total_cost`
- `buy_price`
- `model_year`
- `c_year`
- `repair_cost`
- `repair_details`
- `part_accessories`
- `chassis_number`
- `plate_number`
- `booked_shipping`
- `shipped`
- `picture`
- `status`
- `document_status`
- `initial_document`
- `doc_fee`

### A.2.1 Live `public.cars` columns observed from active project
From live `select * from cars limit 1` key inspection:
- `id`
- `row_id`
- `spec`
- `status`
- `picture`
- `advance_date`
- `income_date`
- `plate_number`
- `province`
- `brand`
- `drive_type`
- `engine_size`
- `grade`
- `gear_type`
- `cabin`
- `color`
- `manufacture`
- `registration`
- `engine_number`
- `chassis_number`
- `mileage`
- `agent`
- `inspector`
- `driver_location`
- `initial_document`
- `document_status`
- `doc_fee`
- `repair_cost`
- `repair_details`
- `advance`
- `buy_price`
- `total_cost`
- `part_accessories`
- `web_price_usd`
- `bf_on_web`
- `requested_modifications`
- `free`
- `booked_date`
- `sale_price_usd`
- `buyer`
- `sale_support`
- `remarks`
- `booked_shipping`
- `destination_port`
- `other`
- `shipped`
- `country`
- `month`
- `c_year`
- `model`
- `model_year`
- `updated_at`
- `raw_data`

Type/nullability note:
- Exact `data_type` / `is_nullable` from DB catalog is not available through current PostgREST exposure.
- Temporary interpretation: treat most business columns as nullable text/number fields unless strict constraints are later confirmed from direct DB catalog access.

### A.3 Car linking keys in current code
- Primary link keys used by order read layer (`src/lib/data/orders.ts`):
  - `car_row_id` <-> `cars.row_id`
  - `car_id` <-> `cars.id`
- Fallback display/search keys used in UI:
  - `chassis_number`
  - `plate_number`
- Current `/m/orders` mapping rule:
  - identity/linking prefers `row_id` first
  - then `id`
  - `chassis_number` is fallback identity for display-safe card id only
  - `plate_number` is display/search only (not data link key)

### A.4 Baseline schema vs runtime schema reality (important)
- `supabase/schema.sql` baseline defines older/minimal fields (`make`, `year`, `price_thb`, `vin`, etc.).
- Current app code (`Car` type + select lists) expects many sheet-style fields (`row_id`, `sale_support`, `sale_price_usd`, `repair_details`, etc.).
- Conclusion: runtime project likely uses an evolved `public.cars` shape not fully represented by baseline SQL file.

### A.5 Field availability (for Order Tracking concerns)
- **Clearly present in app expectations:** `id`, `row_id`, `spec`, `chassis_number`, `plate_number`, `sale_support`, `buyer`, `sale_price_usd`, `total_cost`, `buy_price`, `booked_shipping`, `shipped`, `repair_cost`, `repair_details`, `part_accessories`, `picture`, `status`.
- **Not represented as dedicated normalized fields in cars:** item-level task lines, assignment status lifecycle, due dates, logs, attachments, deposit lifecycle.

## B) Mockup UI -> Existing `cars` Fields

- เลขทะเบียน (plate): `plate_number`
- รุ่นรถ / spec: `spec` (fallback from brand/model logic in helper when needed)
- chassis: `chassis_number`
- sale name: `sale_support`
- buyer: `buyer`
- sale price: `sale_price_usd`
- shipping round (header badge on `/m/orders`): `booked_shipping` only (`shipped` still used elsewhere for sale-status chips / filters)
- cost detail:
  - headline cost: `total_cost` (fallback `buy_price`)
  - optional repair cost: `repair_cost`
- repair detail: `repair_details`
- document detail:
  - composed on the card from `document_status`, `initial_document`, and `doc_fee` (all in `CARS_SELECT_ORDER_TRACKING`)
- expense/accessory link/detail: `part_accessories` (currently text field, not normalized link table)
- photo link: `picture`

## C) Missing Fields For Order Tracking

Fields below are missing as proper normalized structures in `public.cars` and should not be forced into `cars`:
- order task (task header / request container)
- item name (multiple rows per task)
- assignee
- item status lifecycle
- due date of ordered item
- note / update message per status change
- deposit type
- deposit expire date
- activity log / timeline
- attachments (photos, invoices, receipts, documents)

## D) Recommended Tables (Design from current reality)

Notes:
- `order_tasks`, `order_items`, `order_task_updates` are already referenced by code and are natural core tables.
- `public.cars` remains car master only.

Recommended structure direction (planning only, no create now):
- `order_tasks`
  - per-car request header, link by `car_row_id` and/or `car_id`
- `order_items`
  - child rows under `order_tasks` for parts/accessories/work items
- `order_deposits`
  - storage/deposit records with due/expire tracking
- `order_task_updates`
  - timeline/activity log (status changes, remarks, actor, timestamp)
- `order_attachments`
  - file metadata linked to task/item/update
- `order_cost_details` (optional)
  - only if cost granularity exceeds `cars.total_cost` + `cars.repair_cost` + `cars.part_accessories`
  - otherwise keep summary cost on `cars` and task-level detailed costs in updates/notes

## E) Recommended Relations

- `public.cars` = car master.
- `order_tasks` -> `cars` via:
  - `car_id` when numeric key is reliable
  - `car_row_id` as stable external row key from sheet pipeline
- `order_items` -> `order_tasks` (`order_task_id`)
- `order_deposits` -> `order_tasks` (and optional `order_item_id` when deposit belongs to item)
- `order_task_updates` -> `order_tasks` (optional `order_item_id` for item-specific updates)
- `order_attachments` -> `order_tasks` / `order_items` (and optional `order_task_updates`)

## F) Safe Migration Plan (Do not execute now)

1. Read-only mapping (this document)
2. Order Tracking read-only mock data alignment
3. Create schema draft (SQL draft only, no apply)
4. Review with owner (field ownership + workflow agreement)
5. Implement table migration later
6. Add write workflow later
7. Google Sheet one-way sync later
8. Two-way sync later after audit/conflict rules

## G) Risks

- Conflict with Google Sheet Record 2026 as parallel source.
- Duplicate order items when matching by label only.
- Same field edited from Sheet and web at close times.
- Missing `updated_by` attribution on important edits.
- Missing/partial `updated_at` discipline on all related entities.
- Unclear single source of truth for status and cost timeline.
- No complete audit trail for order/item lifecycle yet.
- `row_id` / `chassis` mismatch can cause wrong car linkage.

## Additional Notes (Phase 1)
- Current code already attempts read from `order_tasks` / `order_items` / `order_task_updates`.
- If those tables are absent, app safely degrades to empty/mocks in some flows.
- Final schema confirmation against live Supabase should be run once `.env.local` (or equivalent secure runtime env) is available.

## Storage Table Check (Latest)
- Runtime probe for storage tables via PostgREST returned schema-cache missing for:
  - `order_storage_items`
  - `order_deposits`
  - `order_storage`
  - `storage_items`
- Because storage table is not currently queryable from app runtime path, this repo includes a **draft only** SQL file:
  - `supabase/order-storage-items-draft.sql`
- Draft is documentation/planning only in this phase; no migration was applied.

## order_task_updates Audit Columns Check (Latest)
- Runtime check confirms table `order_task_updates` is queryable with current columns:
  - `id`, `order_task_id`, `role`, `message`, `created_at`
- Required structured audit columns are currently missing in runtime:
  - `order_item_id`, `action_type`, `old_value`, `new_value`, `note`, `updated_by`
- Added draft-only SQL (not applied):
  - `supabase/order-task-updates-audit-draft.sql`
- Current implementation stores audit details inside `message` text (including action type + old/new snapshots) until structured columns are available.

## QA Data Probe Notes (Latest)
- Real-data probe confirms:
  - `cars` rows available
  - `order_tasks` rows available
  - `order_items` rows available
  - `order_task_updates` rows available
- Probe also shows runtime mismatch for optional item columns in current environment:
  - `order_items.assignee_staff` query failed in direct probe (`column does not exist`)
  - app currently uses fallback-safe logic and still runs
- Storage runtime blocker remains:
  - `order_storage_items` unresolved in PostgREST schema cache for current app runtime path
