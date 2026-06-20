# Order Tracking Chip Cache Architecture Plan

Mode: `[OrderTracking]`

Status: architecture plan only. This document does not implement runtime behavior, create tables, run migrations, or change the Supabase schema.

## Goal

The `/m/orders` screen needs two separate responsibilities:

1. Chip/count/relationship layer: fast, reliable counts for related chips under the current filter context.
2. Card list/detail layer: load matching car cards in small batches without hydrating every full detail row up front.

The goal is to make chip numbers trustworthy while keeping the mobile card list fast. Any production implementation must be additive, reversible, and behind a feature flag.

## Current Problem

The screen can mix several kinds of numbers:

- Full-system sale summaries.
- Counts derived from currently loaded cards.
- Counts derived from progressively hydrated order item details.
- Search results that can find cars outside the first visible card batch.

When progressive loading is active, card details may be incomplete while chip numbers still look like totals. This can confuse users because tapping one chip should update all related chip groups consistently.

## Feature Flag

Suggested flag:

```env
NEXT_PUBLIC_ORDER_CHIP_CACHE_ENABLED=false
```

Rules:

- `false`: use the existing `/m/orders` logic.
- `true`: use the chip cache and filtered-card loading architecture.
- Do not commit `.env.local`.
- Do not print secrets.
- Treat this as an experiment until production QA signs off.

## Proposed Table Schema

Potential additive table: `order_tracking_chip_cache`

This is planning only. Do not run this migration yet.

```sql
create table public.order_tracking_chip_cache (
  id bigserial primary key,
  scope text not null,
  scope_key text not null default 'global',
  filter_hash text not null,
  filter_json jsonb not null default '{}'::jsonb,
  counts_json jsonb not null default '{}'::jsonb,
  total_cars integer not null default 0,
  total_items integer not null default 0,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index order_tracking_chip_cache_scope_filter_uidx
  on public.order_tracking_chip_cache (scope, scope_key, filter_hash);
```

Suggested scope strategy:

- `global`: no primary chip selected.
- `sale`: one or more sale chips selected.
- `sale_status`: one or more sale status chips selected.
- `staff`: one or more staff chips selected.
- `item_status`: one or more item status chips selected.
- `compound`: multi-group filters that cannot be represented by one scope.
- `search`: optional short-lived or computed-on-demand cache for normalized search text.

Suggested `filter_hash`:

- Stable hash of canonical `filter_json`.
- Use sorted keys and sorted arrays before hashing.
- Search text should be normalized before hashing.
- Avoid including paging cursors, because chip counts represent the whole filtered result, not a page.

## Counts JSON Structure

Example shape:

```json
{
  "sale_status": {
    "ทั้งหมด": 917,
    "จอง": 67,
    "รอส่ง": 120,
    "ส่งแล้ว": 730,
    "ว่าง": 0
  },
  "sales": {
    "GWANG": 917,
    "AOR": 256
  },
  "staff": {
    "PREW": 120,
    "JOY": 80,
    "ไม่ระบุชื่อ": 12
  },
  "item_status": {
    "เช็ค": 177,
    "มี": 249,
    "สั่ง": 10,
    "มา": 11,
    "รถนอก": 4,
    "ช่างนอก": 13,
    "จบ": 3
  },
  "meta": {
    "total_cars": 917,
    "total_items": 584,
    "computed_at": "2026-05-19T00:00:00.000Z",
    "source": "order_tracking_chip_cache",
    "is_full_system": true
  }
}
```

Meaning:

- `sale_status`: car-level counts under the current filter context.
- `sales`: car-level counts by `cars.sale_support`.
- `staff`: item-level counts by `order_items.assignee_staff`.
- `item_status`: item-level counts by `order_items.status`.
- `meta.source`: makes it explicit whether the number came from cache, loaded cards, or fallback logic.
- `meta.is_full_system`: true only when counts represent the whole matched dataset.

## Filter Keys To Support

Minimum supported filter keys:

- `sale`: sale code chips such as `GWANG`, `AOR`, `WAN`.
- `saleStatus`: `จอง`, `รอส่ง`, `ส่งแล้ว`, `ว่าง`.
- `staff`: assignee names and the unassigned bucket.
- `itemStatus`: order item statuses such as `เช็ค`, `มี`, `สั่ง`, `มา`, `จบ`.
- `search`: normalized text from plate, chassis, spec, and other current car keyword fields.
- `shipping`: existing booked-shipping round filters if active.
- `buyer`: existing booked-buyer filters if active.
- `modelYear`: existing model-year filters if active.

Canonical filter JSON example:

```json
{
  "sale": ["GWANG"],
  "saleStatus": ["รอส่ง"],
  "staff": ["JOY"],
  "itemStatus": ["เช็ค"],
  "search": "4823",
  "shipping": [],
  "buyer": [],
  "modelYear": []
}
```

Rules:

- Arrays must be sorted.
- Empty arrays mean no filter for that dimension.
- Search should be trimmed, uppercased where useful, and normalized consistently with the UI search.
- The filter JSON should not contain page size or cursor.

## Relationship Behavior

All chip groups should be recomputed from the same filter context.

### Tap Sale Chip

When user taps `GWANG`:

- Selected filter becomes `sale=["GWANG"]`.
- Sale status chip counts show only cars related to `GWANG`.
- Staff chip counts show only items related to `GWANG`.
- Item status counts show only items related to `GWANG`.
- Card query changes to cards matching `GWANG`.

### Tap Sale Status Chip

When user taps `รอส่ง`:

- Selected filter includes `saleStatus=["รอส่ง"]`.
- Sale chips show only sales with cars in `รอส่ง`.
- Staff and item status counts show related items for cars in `รอส่ง`.
- Card query loads only matched `รอส่ง` cards.

### Tap Staff Chip

When user taps `JOY`:

- Selected filter includes `staff=["JOY"]`.
- Sale and sale status chip counts show cars with matching JOY-owned items.
- Item status counts show JOY-owned item status distribution.
- Card query loads cars with matching JOY-owned items.

### Tap Item Status Chip

When user taps `เช็ค`:

- Selected filter includes `itemStatus=["เช็ค"]`.
- Sale, sale status, and staff counts show only the related matched set.
- Card query loads cars with at least one matching `เช็ค` item.

### Multi-Chip Selection

Recommended rule:

- Within the same chip group: OR.
- Across different chip groups: AND.

Example:

- `sale=["GWANG","AOR"]` means GWANG OR AOR.
- `sale=["GWANG"]` plus `saleStatus=["รอส่ง"]` means GWANG AND รอส่ง.
- `staff=["JOY"]` plus `itemStatus=["เช็ค","มี"]` means JOY AND (เช็ค OR มี).

### Clear Filter Behavior

Clear all filters should:

- Reset all chip groups to the global cache row.
- Reset search text.
- Reset card cursor.
- Load the first card batch again.
- Keep feature flag state unchanged.

## Card Loading Strategy

Cards should be loaded by query, not by hydrating every card in the client.

Proposed API shape:

```ts
type GetOrderTrackingCardsInput = {
  sale?: string[];
  saleStatus?: string[];
  staff?: string[];
  itemStatus?: string[];
  search?: string;
  shipping?: string[];
  buyer?: string[];
  modelYear?: string[];
  limit: 50;
  cursor?: string | null;
};

type GetOrderTrackingCardsResult = {
  cards: OrderTrackingCard[];
  nextCursor: string | null;
  totalMatched: number;
  countsSource: "chip_cache" | "query" | "loaded_cards";
};
```

Suggested endpoint later:

```ts
getOrderTrackingCards({
  sale,
  saleStatus,
  staff,
  itemStatus,
  search,
  limit: 50,
  cursor
});
```

Card query behavior:

- First page: load first 50 full card details.
- Scroll near bottom: request next 50 with `cursor`.
- New filter: clear card list and request first 50 for the new filter.
- Search: query full index/dataset first, then hydrate matching card details.
- Keep a client-side detail cache keyed by `row:{row_id}` or `id:{id}` to avoid duplicate detail requests.

Cursor strategy:

- Prefer stable sort by `updated_at desc`, then `row_id` or `id`.
- Cursor can be encoded as `{ updated_at, row_id, id }`.
- Cursor must not affect chip counts.

## Search Behavior

Search must not depend only on the first 50 cards.

Requirements:

- Search against a full lightweight car index or server query.
- Match current behavior for plate, full plate, chassis, and spec keywords.
- Hydrate details only for matched cars that are visible or about to be visible.
- Cache hydrated results by car key.
- If search changes, preserve already-hydrated card details in cache when keys still match.

Search count behavior:

- If chip cache supports search, use `scope="search"` or `scope="compound"` with normalized `search`.
- If cache does not support arbitrary search yet, calculate search chip counts on demand from the lightweight index and clearly label the source as query/index, not full detail hydration.

## Cache Refresh Plan

Safe refresh choices:

1. Manual refresh script/admin action later.
2. Scheduled job later.
3. Refresh a small affected scope after order update later.
4. Rebuild global cache after bulk imports later.

Refresh sources:

- `public.cars` for sale status, sale code, shipped/booking/model-year data.
- `order_tasks` for car linkage.
- `order_items` for staff and item status data.
- Existing order update APIs can later enqueue cache refresh, but should not block saves.

Do not add yet:

- Google Sheet Sync.
- LINE Bot ingestion.
- Two-way sync.
- Schema migration without approval.

## API Plan

Potential future endpoints behind the feature flag:

```ts
GET /api/m/order-tracking/chip-counts?filter=...
POST /api/m/order-tracking/cards
POST /api/m/order-tracking/chip-cache/refresh
```

Initial implementation should prefer server-side helpers before adding too many endpoints:

- `getOrderTrackingChipCounts(filter)`
- `getOrderTrackingCards(filter, cursor, limit)`
- `normalizeOrderTrackingFilter(input)`
- `hashOrderTrackingFilter(filter)`

## UI Source Labels

To avoid confusing users:

- Full-system cache counts can be labeled internally as `ยอดรวมทั้งระบบ`.
- Loaded-card-only counts must be labeled internally as `ตัวเลขสัมพันธ์จากรายการที่โหลดอยู่`.
- The UI should not mix both without a clear source in code.
- If `ORDER_TRACKING_MAX_CARS` limits results, show the small message: `ตัวเลขสัมพันธ์จากรายการที่โหลดอยู่`.

## Rollback And Safety Plan

Rollback rules:

- Feature flag off means old behavior continues.
- `order_tracking_chip_cache` is additive only.
- No changes to `public.cars`.
- No removal of current order logic.
- No removal of existing `/m/orders` route.
- No production behavior change unless flag is enabled.
- If QA fails, close the PR or set `NEXT_PUBLIC_ORDER_CHIP_CACHE_ENABLED=false`.
- If cache data is stale, fall back to existing loaded-card/query counts.

Operational safety:

- Keep old helpers and UI paths until cache mode is stable.
- Do not make saves depend on cache refresh.
- Cache refresh should be best-effort and observable.
- Add logging for cache miss/stale/fallback later, without printing secrets.

## Phased Implementation Plan

### Phase 1: Fix labels/count clarity

- Make count source explicit in code.
- Show `ยอดรวมทั้งระบบ` vs `ตัวเลขสัมพันธ์จากรายการที่โหลดอยู่` where needed.
- No schema change.

### Phase 2: Progressive card detail loading

- Load lightweight car index first.
- Hydrate first 50 cards.
- Scroll loads next 50.
- Search uses full index and hydrates matched cards only.

### Phase 3: Add chip cache table behind feature flag

- Add migration in a reviewed PR.
- Keep feature flag default `false`.
- Add read helper for `order_tracking_chip_cache`.
- Add cache miss fallback to current logic.

### Phase 4: Use chip cache for related counts

- When flag is true, selected chips request related counts from cache.
- Cards still load from filtered card query.
- Multi-chip rules use OR within group and AND across groups.

### Phase 5: Checker section later

- Add a checker/admin section to validate cache freshness and count mismatches.
- Provide manual refresh only after review.
- Do not add Google Sheet Sync, LINE Bot, or two-way sync.

## Acceptance Checklist For Later Implementation

- Tapping any chip updates all related chip groups from the same filter context.
- Card list matches selected filters.
- Search finds cars outside the first 50.
- Detail hydration happens only for visible/matched cards.
- Client does not refetch already-hydrated details.
- Feature flag off returns current behavior.
- Build passes.
- No `.env.local` committed.
- No Supabase schema change without explicit migration approval.

## Recommended Next Issue

Create a small implementation issue for Phase 1 only: add count-source labels and guardrails so users can tell whether chips are full-system totals or derived from loaded cards. Keep the chip cache table and migration for a later reviewed issue.
