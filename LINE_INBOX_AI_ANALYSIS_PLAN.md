# LINE Inbox — AI Analysis Plan

Task mode: `[LINEBridge]` · Planning / design only — **no migration applied**, **no auto-save from AI**, **no secrets in browser**.

## 1. Purpose

Provide **assistant-level** analysis of LINE messages (text + optional attachments metadata) so staff can decide what each line means in **Order Tracking** terms: suggested work items, duplicate hints, and car linkage — **before** any write to `order_items`.

- AI **recommends**; humans **confirm**.
- Compare against **existing `order_items` for the same car** (loaded server-side by `car_row_id` / detected car).
- **Primary car key:** `cars.row_id` → `car_row_id`. **`chassis_number`** fallback for matching when `row_id` missing in payload. **`plate_number`** — search/display only, not authoritative link key.
- **Do not** persist `order_items` from the analyze endpoint.
- **Do not** let the model decide solely from images without a **car anchor** (selected car or high-confidence detection from text) and ideally an **item/work anchor** from text; otherwise mark `unclear` / `needs_human_review`.

---

## 2. What AI Can Analyze

| Capability | Notes |
|------------|--------|
| **Segment lines** | Split multiline / bullet chat into candidate “work lines”. |
| **Normalize names** | Propose `suggested_item_name` (short, ops-friendly Thai or mixed). |
| **Category** | Map line to `suggested_category` (closed list below). |
| **Status hint** | Propose `suggested_status` from closed list; align with Order Tracking vocabulary. |
| **Duplicate signal** | Compare to loaded `order_items` for that car (name + status rules). |
| **Car detection** | From **text**: plate-like tokens, chassis patterns, sale cues — output `detected_car` with confidence. **Images:** only supportive; never sole authority without text anchor per guardrails. |
| **Risk flags** | Low confidence, ambiguous car, conflicting lines → `needs_human_review: true`. |

---

## 3. Splitting LINE Text Into Work Items

1. **Preserve order** of lines as user sent.
2. Split on: newlines, numbered lists (`1.`, `1)`), bullets (`-`, `•`), and Thai enumerators where obvious.
3. Merge continuation lines (no bullet, short line following a task line) into previous `raw_text` chunk heuristically.
4. Drop pure greetings/thanks/stickers-only buckets → empty `items` or single low-confidence row with `duplicate_status: "unclear"`.
5. Each chunk becomes one object in `items[]` with `raw_text` = verbatim substring.

---

## 4. Classify — `suggested_category`

Closed list ( English snake_case in JSON ):

| Value | Meaning (ops) |
|-------|----------------|
| `parts_order` | สั่งอะไหล่ / แจ้งรายการสั่งของ |
| `installation` | ติดตั้ง / แต่ง |
| `repair` | ซ่อม / แก้ไข mechanical |
| `paint` | สี / เก็บสี |
| `document` | เอกสาร / ป้าย / Custom |
| `storage` | ฝาก / คลัง |
| `qc` | ตรวจ / QC / ส่งมอบก่อนเรือ |
| `other` | อื่น ๆ |

---

## 5. Suggest Status — `suggested_status`

Closed list aligned with this plan (normalize to DB enums in implementation layer):

- `เช็ค`, `มี`, `ต้องสั่ง`, `สั่ง`, `มา`, `รถนอก`, `ช่างนอก`, `ฝาก`, `จบ`

**Implementation note:** Production Order Tracking may use finer codes (e.g. `ฝากสโตร์` / `ฝากกับรถ`). The **confirm** API should map `ฝาก` → the correct DB status using business rules or user override in UI.

**Heuristics (non-binding):**

- Words like “สั่งแล้ว”, “รอของ”, “due” → toward `สั่ง` / `ต้องสั่ง`.
- “ของมา”, “รับของ” → toward `มา`.
- “ช่าง”, “อู่นอก” → toward `ช่างนอก`.
- “ฝาก”, “คลัง”, “storage” → toward `ฝาก`.
- “จบ”, “เสร็จ”, “ปิดงาน” → toward `จบ` (but duplicate rules may still prefer **new** row if old item already `จบ`).

---

## 6. Duplicate Detection vs Existing `order_items`

**Server loads** all `order_items` for the resolved car (`order_tasks` joined by `car_row_id` / `car_id`). Items considered **active** if `status !== 'จบ'` (or equivalent terminal state in DB).

### Rules

| Condition | `duplicate_status` |
|-----------|-------------------|
| Exact normalized name match + same car + existing item **not** `จบ` | `duplicate` |
| Similar name (fuzzy / token overlap / edit distance threshold) + same car | `possible_duplicate` |
| No matching existing item | `new` |
| No car match OR unusable text OR image-only without anchor | `unclear` |

### “จบ” exception

If the only match is an existing item with status **`จบ`**, default suggestion: **treat as `new`** (new line item) **unless** the message clearly indicates updating/reopening that same job (explicit reference, same invoice number, “แก้งานเดิม”, etc.) → then `possible_duplicate` or `duplicate` with human confirmation.

### Deterministic pre-check (before / instead of LLM)

Implement **deterministic** normalization (trim, collapse spaces, lowercase Latin, strip punctuation) and:

1. Exact match on normalized `item.name` → `duplicate`.
2. Token-set Jaccard or trigram similarity above threshold → `possible_duplicate`.
3. Else pass to AI **only if** `LINE_INBOX_AI_AMBIGUOUS_ONLY=true` (or similar) for ambiguous lines.

Analyze API **never inserts** rows; it only returns JSON.

---

## 7. Confidence Scores

- **`detected_car.confidence`** — 0–1: plate/chassis/row hints consistency; penalize if only plate match.
- **Per-item `confidence`** — 0–1: combine category clarity, name quality, duplicate clarity.
- **Global `needs_human_review`** — `true` if any of:
  - car confidence &lt; threshold (e.g. 0.6),
  - any item `duplicate_status` is `possible_duplicate` or `unclear`,
  - multimodal mismatch (text says car A, weak image hint says B).

Thresholds are tunable server-side env vars.

---

## 8. Human Confirmation Flow

1. User opens **LIFF `/liff/line-inbox`** (future): sees message + **AI suggestion per line**.
2. Badges: **งานใหม่** (`new`), **ซ้ำเดิม** (`duplicate`), **อาจซ้ำ** (`possible_duplicate`), **ข้อมูลไม่พอ** (`unclear`).
3. Per line actions: **เพิ่มใหม่**, **รวมกับงานเดิม** (pick matched id), **แก้ชื่อก่อนบันทึก**, **ข้าม**.
4. **Final “Confirm”** (single primary action) sends payload to **`POST /api/line-inbox/confirm`** — only then server writes DB.

---

## 9. Risks & Fallbacks

| Risk | Mitigation |
|------|------------|
| Wrong car linked | Require `car_row_id` from user when detector confidence low; show picker. |
| Label-only duplicate false positives | Fuzzy band → `possible_duplicate` + human merge. |
| Image-only messages | Refuse auto-link; `unclear` + prompt user to pick car / paste text. |
| LLM hallucination | Structured JSON schema + validate; invalid payload → error, no write. |
| Cost / latency | Deterministic pass first; LLM optional for ambiguous subset. |

---

## 10. AI Output JSON Schema

```json
{
  "detected_car": {
    "plate_text": "",
    "chassis": "",
    "car_row_id": "",
    "confidence": 0
  },
  "items": [
    {
      "raw_text": "",
      "suggested_item_name": "",
      "suggested_category": "",
      "suggested_status": "",
      "duplicate_status": "new | duplicate | possible_duplicate | unclear",
      "matched_order_item_id": "",
      "matched_item_name": "",
      "confidence": 0,
      "reason": ""
    }
  ],
  "needs_human_review": true
}
```

- `matched_order_item_id` / `matched_item_name` populated when `duplicate` or `possible_duplicate`.
- Empty strings allowed where N/A.

---

## 11. UI — `/liff/line-inbox` (minimal LIFF page)

- Implemented: **`src/app/(app)/liff/line-inbox/page.tsx`** + **`src/components/liff/line-inbox-client.tsx`** (`LiffOrdersShell`).
- List each **source line** with badge + editable label/status + action (**ข้าม** / **สร้างงานใหม่** / **รวมกับงานเดิม** when a match id exists).
- **ยืนยันบันทึกลงระบบ** calls **`POST /api/line-inbox/confirm`** only after review.
- No AI keys in client; analyze/confirm are server routes.

---

## 12. API Plan

### `POST /api/line-inbox/analyze`

**Payload (conceptual):**

```json
{
  "line_inbox_message_id": "",
  "raw_text": "",
  "car_row_id": "",
  "attachments": []
}
```

**Server:**

1. Resolve car: prefer `car_row_id` from client; else run **detection** from `raw_text` only (plate/chassis hints) — never trust image alone for primary key in v1.
2. Load **existing `order_items`** for that car (via `order_tasks`).
3. Run **deterministic duplicate** rules.
4. Optionally call **AI** for ambiguous lines if configured (env).
5. Return suggestion JSON — **no writes** to `order_items`.

### `POST /api/line-inbox/confirm`

**Only after user confirms.**

- Create/update `order_items` as per user choices.
- Attach files → `order_attachments` (when table exists).
- Set `line_inbox_messages.status = saved` (when table exists).
- Append **audit** to `order_task_updates` (existing message-encoding pattern until structured columns land).

---

## 13. Save Plan (Confirm Endpoint Behavior)

1. Validate session/auth policy (reuse existing open-mutation flags if applicable).
2. Apply user intent: new row vs merge into `matched_order_item_id`.
3. Use **service role** server-side only for writes.
4. Transaction where possible: item upsert + attachment rows + inbox status + audit log.

---

## 14. Explicit Non-Goals (This Phase)

- No DB migration executed from this task.
- No auto-save from analyze or webhooks.
- No exposing **AI API keys**, **LINE channel secret**, or **service role** to browser.
- No changes to **Dashboard** or **Cars** modules.
- No Google Sheet sync.
- No two-way Sheet sync.
- **`/liff/line-inbox`** route ships with minimal analyze → confirm UI.

---

## 15. Next Implementation Steps (Future Tasks)

1. Add DB tables (draft SQL only until approved): `line_inbox_messages`, optional link to LINE message ids.
2. ~~Optional: **zod** validation on analyze/confirm payloads.~~ **Done** — `src/lib/line-inbox/api-schemas.ts`.
3. **`order_attachments`** on confirm when table exists; persist **`line_inbox_messages.status`** when table exists.
4. Optional external AI for ambiguous lines (env-gated), keeping analyze read-only.

---

## References

- `ORDER_TRACKING_DB_MAPPING.md` — car keys, `order_items` shape.
- `ORDER_TRACKING_PLAN.md` — module scope.
- `LINE_LIFF_SETUP.md` — LIFF constraints.
- `CURSOR_RULES.md` — module boundaries.
