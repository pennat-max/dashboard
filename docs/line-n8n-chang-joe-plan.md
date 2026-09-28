# VIGO4U LINE + n8n Plan for Chang Joe

Status: production workflow prepared. Production LINE webhook remains on the ChatGPT Site.

## Architecture

```text
LINE OA
→ ChatGPT Site /api/line/webhook
→ Verify LINE signature
→ Capture text/image/file metadata in line_inbox_messages
→ n8n on Chang Joe triggers the queue every minute
→ Analyze pending messages through existing parser/AI pipeline
→ Matched car: auto-save work and attach related LINE photos
→ Unmatched car: keep only in the AI · LINE problem drawer
→ Send one completion reply only after a matched job is saved
→ D1 + R2
→ Staff sees only car-match problems in the AI · LINE problem drawer
→ Saved work is immediately available in Order Tracking
```

## Production Runtime

```text
ACTIVE=true
DRY_RUN=false
AUTO_SAVE=true
LINE_REPLY=true
USE_AI=true
LIMIT=20
SCHEDULE=every 1 minute
```

No secret, token, LINE channel secret, password, or service role key is stored in this repository or in the n8n export.

## Site API Surface for n8n

All endpoints require:

```text
Authorization: Bearer <LINE_N8N_WORKER_SECRET or LINE_INBOX_CRON_SECRET>
```

The new endpoints are disabled unless `LINE_N8N_ENABLED=true`.

| Endpoint                              | Method | Purpose                                                | Writes                      |
| ------------------------------------- | ------ | ------------------------------------------------------ | --------------------------- |
| `/api/n8n/line-inbox/health`          | GET    | Check flags, auth readiness, pending/error counts      | No                          |
| `/api/n8n/line-inbox/pending-queue`   | GET    | Read lightweight pending/error queue summaries         | No                          |
| `/api/n8n/line-inbox/analyze-pending` | POST   | Run existing analyze pipeline on captured pending rows | Updates analyze fields only |
| `/api/n8n/line-inbox/replay-errors`   | POST   | Dry-run or reset failed analyze rows to pending        | Dry-run by default          |

Existing staff UI endpoints remain unchanged:

- `/api/line-inbox/pending-queue`
- `/api/line-inbox/pending-save`
- `/api/line-inbox/analyze-pending`
- `/api/line/webhook`

## n8n Workflow Design

1. Manual trigger remains available for diagnosis; the production schedule runs every minute.
2. Runtime guard checks:
   - `ACTIVE=true`
   - `DRY_RUN=false`
   - `AUTO_SAVE=true`
   - `LINE_REPLY=true`
   - `USE_AI=true`
3. Health check calls the Site n8n health endpoint.
4. Analyze step calls the existing Site analyzer with AI enabled, up to 20 rows per run.
5. Queue summary reads current queue after analyze.
6. Error inspection remains read-only to prevent an infinite retry loop.
7. The Site, not n8n, performs car matching, persistence, photo linking, and the LINE completion reply.

## Classification

n8n should treat results as:

- Matched car: persist automatically, including photos related to the LINE message.
- Unmatched car: do not persist; show it in the LIFF AI · LINE problem drawer.
- Analyze error: leave it in the error queue for inspection.
- Auth or Site failure: n8n retries the HTTP request up to three times.

Item-confidence and human-review hints do not block a message after a real `car_row_id` has been resolved.

## Error Queue and Replay

Failed rows stay in `line_inbox_messages` with `analyze_status=error`.

Replay path:

1. The scheduled workflow calls `POST /api/n8n/line-inbox/replay-errors` with `{ "dry_run": true }`.
2. Review the returned rows before resetting them.
3. A deliberate manual run with `{ "dry_run": false }` resets selected failed rows to pending.
4. The next scheduled run analyzes them again.

## Cutover Rule

Do not point LINE OA webhook to n8n during phase 1. Keep ChatGPT Site as the public ingress because it already verifies LINE signature and captures images/files.

## File

Importable production workflow (legacy filename retained so existing deployment notes still resolve):

```text
docs/n8n/line-inbox-dry-run-workflow.json
```
