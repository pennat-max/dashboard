# PROJECT_TASKS

## Current Focus
- **[OrderTracking]** Mobile UX reference: **`docs/mockups/order-tracking-mobile-mockup.tsx`** (standalone; **REFERENCE ONLY**, not imported by app routes). Implementations stay in **`mobile-order-tracking-home.tsx`** with real Supabase data paths unchanged.
- **[OrderTracking]** Mobile Order Tracking at `/m/orders` — **real reads** (`cars` + `order_tasks` / `order_items`) with **mock fallback** when no cars; **inline intake save** to DB via **`POST /api/m/order-intake/save`** (requires `SUPABASE_SERVICE_ROLE_KEY`). Separate **`/m/orders/receive-line`** page remains **mock-only**.
- **[OrderTracking]** Card header/cost mapping aligned with `ORDER_TRACKING_DB_MAPPING.md`: ship badge = `booked_shipping` only; document panel includes `doc_fee`; cost headline prefers `total_cost`; title line includes model year when present.
- **[ProjectOrganization]** Supabase CLI available locally via `npx supabase` (devDependency `supabase@^2.98.0`); `supabase/config.toml` present. Next: optionally `supabase login` + `supabase link --project-ref <from Dashboard>` when schema/migration workflow is approved — **do not** push or apply migrations without explicit sign-off.

## Dashboard Stabilization
- [x] Dashboard read-only pages exist.
- [x] KPI/dashboard aggregation exists.
- [x] Income schedule page and dashboard navigation are implemented.
- [ ] Resolve remaining runtime warnings (chart sizing/module-type warning).
- [ ] Final dashboard QA pass for data consistency across cards/pages.

## Cars Module
- [x] Cars list page exists (`/cars`).
- [x] Car detail page exists (`/cars/[id]`).
- [x] Supabase-backed read connection exists for cars data.
- [ ] Add explicit module-level test checklist/documentation.

## Order Tracking Module
- [x] Added DB mapping document: `ORDER_TRACKING_DB_MAPPING.md` (Phase 1 read-only mapping from repo schema/types/code, no schema change).
- [x] Primary mobile UI: **`/m/orders`** → `MobileOrderTrackingHome` (`src/components/orders/mobile-v2/mobile-order-tracking-home.tsx`).
- [x] Server data for list: `fetchCarsForOrderTracking` + `fetchOrderItemsByCars` in `src/app/(app)/m/orders/page.tsx`.
- [x] Fallback mock orders in-component when `carsData` is empty (`ORDERS` constant).
- [x] `/m/orders/[id]` redirects to list; `.old` page backups kept.
- [x] **Read path** uses `order_tasks` + `order_items` (see `src/lib/data/orders.ts`) with missing-table graceful empty.
- [x] **Write path (partial):** `POST /api/m/order-intake/save` + `src/lib/supabase/service-role.ts` — creates task if missing, upserts items by **label** match for expanded intake save only.
- [x] Added card edit write API: `POST /api/m/order-items/update` (service role) for single-item update/upsert.
- [x] Filters implemented: sale **status** chips, staff, item status (**label** “สถานะรายการ”) + counts, storage-only, plate keypad (sale-name chip filter **removed** from this screen).
- [x] Item row UX vs mock reference: stacked layout on xs / horizontal from `sm`; date chip only when **สั่ง** (**เลือกวันที่** / **มา {date}**); **ฝาก** chip label from DB `storage_type`; **ดูทั้งหมด** dashed/outline like mock; inline LINE caption “รับงานจาก LINE · รถคันนี้เท่านั้น”.
- [x] COST panel vs mock: dark **สรุปต้นทุน** header; **ค่าอะไหล่/ของแต่ง** always in header (link or muted); three inner sections — no photo in panel.
- [x] Card toolbar: **เพิ่มงาน**, **รอ/จบ** count, **แชร์** only when car has storage rows; removed standalone **Copy สรุป**.
- [x] Item status filter counts use **`itemStatusCounts`** only (same derivation for Supabase cars and demo **`ORDERS`** fallback — no `STATUS_COUNTS` constant).
- [x] Inline expand intake: show existing items from **real** merged items; LINE paste split; duplicate hint; add row; save via API.
- [x] On-card item edits now persist with optimistic update: name, status, assignee, due date, note (fallback when optional DB columns are unavailable).
- [x] Added storage API: `POST /api/m/order-storage/upsert` (service role) for "ฝาก" flow.
- [x] `/m/orders` now loads storage rows from DB helper `fetchOrderStorageByCars` and maps into card `storage`.
- [x] Card UI supports "ฝาก" -> `Store 1 เดือน` / `ไปกับรถ` with optimistic chip and lock-once behavior.
- [ ] If runtime table is missing from PostgREST schema cache, storage save/read returns graceful fallback error until table is exposed.
- [ ] **`/m/orders/receive-line`:** still `MobileReceiveLineFlow` + `mobile-mock.ts` — **not** wired to Supabase.
- [x] Added server audit helper and logging across item/storage/intake writes into `order_task_updates` (message-based payload with action_type + old/new snapshots).
- [x] Added card timeline read for `/m/orders`: load `order_task_updates` by car/task and show latest history in each card (`ประวัติ` + ดูเพิ่ม).
- [x] `/m/orders` now separates real mode vs demo fallback with explicit banner; no silent mix of mock + real rows.
- [x] Added card runtime state feedback for QA: data warning banner, per-row saving indicator, and save error text.
- [x] Storage section in card is collapsible (`ดูฝาก` / `ซ่อนฝาก`) for shorter mobile cards.
- [ ] Structured audit columns on `order_task_updates` (`action_type`, `old_value`, `new_value`, etc.) still require DB-side schema update (draft only in repo).
- [x] Added QA artifact: `ORDER_TRACKING_QA_CHECKLIST.md` with mobile end-to-end test matrix.
- [ ] Storage QA cases (ฝาก Store 1 เดือน / ฝากไปกับรถ / filter ของฝาก) are blocked until `order_storage_items` is queryable in runtime schema cache.
- [ ] No LINE Bot / LIFF.
- [ ] No Google Sheet sync in repo.

## Mobile Operations
- [x] Mobile-first order UI (`mobile-v2`) with large touch targets and chips.
- [x] Thai-first labels on mobile order surfaces.
- [ ] Unify or retire duplicate “receive LINE” experiences (full intake vs `/receive-line` mock).

## Google Sheet Sync
- [ ] Not built.

## LINE Bridge
- [x] Copy-ready LINE URL/text patterns on cards (storage summary) where data exists.
- [ ] Real LINE Bot / LIFF / webhook ingestion.

## Future Two-way Sync
- [ ] Not built.

## Tooling / Supabase CLI
- [x] Supabase CLI installed as dev dependency; `npx supabase --version` works; `supabase init` produced `supabase/config.toml` (local defaults only).
- [ ] Link remote project (`supabase link --project-ref …`) when ref is confirmed — **never guess** project ref.
- [ ] Optional: add versioned `supabase/migrations/*.sql` from existing patch SQL files; CI `supabase db push` only after secrets + review.

## Do Not Do Yet (product guardrails — adjust when scope changes)
- [ ] Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- [ ] Do not assume RLS allows anon inserts on `order_tasks` / `order_items` (writes go through API + service role).

## Current Baseline Confirmed
- [x] `npm run build` passes (verified after item-status counts use only `itemStatusCounts`, May 2026).
- [x] Dashboard + Cars read paths unchanged in scope of this note.
- [x] `/m/orders` is the canonical Order Tracking mobile entry.
