# VIGO4U LINE + n8n Plan for Chang Joe

Status: ready for dry-run wiring. Production LINE webhook is not changed by this plan.

## Architecture

```text
LINE OA
→ ChatGPT Site /api/line/webhook
→ Verify LINE signature
→ Capture text/image/file metadata in line_inbox_messages
→ n8n on Chang Joe pulls pending rows
→ Analyze pending messages through existing parser/AI pipeline
→ Classify High confidence / Human review / Blocked
→ Send result back to ChatGPT Site APIs
→ D1 + R2
→ Staff review in /m/orders
→ Reply LINE later only after owner approval
```

## Production Safety Defaults

```text
ACTIVE=false
DRY_RUN=true
AUTO_SAVE=false
LINE_REPLY=false
USE_AI=false
```

No secret, token, LINE channel secret, password, or service role key is stored in this repository or in the n8n export.

## Site API Surface for n8n

All endpoints require:

```text
Authorization: Bearer <LINE_N8N_WORKER_SECRET or LINE_INBOX_CRON_SECRET>
```

The new endpoints are disabled unless `LINE_N8N_ENABLED=true`.

| Endpoint | Method | Purpose | Writes |
| --- | --- | --- | --- |
| `/api/n8n/line-inbox/health` | GET | Check flags, auth readiness, pending/error counts | No |
| `/api/n8n/line-inbox/pending-queue` | GET | Read lightweight pending/error queue summaries | No |
| `/api/n8n/line-inbox/analyze-pending` | POST | Run existing analyze pipeline on captured pending rows | Updates analyze fields only |
| `/api/n8n/line-inbox/replay-errors` | POST | Dry-run or reset failed analyze rows to pending | Dry-run by default |

Existing staff UI endpoints remain unchanged:

- `/api/line-inbox/pending-queue`
- `/api/line-inbox/pending-save`
- `/api/line-inbox/analyze-pending`
- `/api/line/webhook`

## n8n Workflow Design

1. Manual trigger first; schedule node is included but disabled.
2. Runtime guard checks:
   - `ACTIVE=false`
   - `DRY_RUN=true`
   - `AUTO_SAVE=false`
   - `LINE_REPLY=false`
3. Health check calls the Site n8n health endpoint.
4. Analyze step calls existing analyzer through the Site API with `use_ai=false`.
5. Queue summary reads current queue after analyze.
6. Replay error step runs in dry-run mode only.
7. Future branch can notify Telegram/LINE internal group, but not reply to customer LINE OA yet.

## Classification

n8n should treat results as:

- High confidence: analyzed, matched car, no manual review flag, no errors.
- Human review: analyzed but `needs_human_review=true`, duplicate/merge decision, photo context, or low confidence.
- Blocked: missing car, analyze error, auth failure, disabled flag, or Site API failure.

High confidence is still review-only until `AUTO_SAVE=true` is separately approved.

## Error Queue and Replay

Failed rows stay in `line_inbox_messages` with `analyze_status=error`.

Replay path:

1. `POST /api/n8n/line-inbox/replay-errors` with `{ "dry_run": true }`
2. Owner reviews returned rows.
3. Only after approval, send `{ "dry_run": false }` to reset those rows to pending.
4. Run analyze pending again.

## Cutover Rule

Do not point LINE OA webhook to n8n during phase 1. Keep ChatGPT Site as the public ingress because it already verifies LINE signature and captures images/files.

## File

Importable dry-run workflow:

```text
docs/n8n/line-inbox-dry-run-workflow.json
```
