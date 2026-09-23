# Chang Joe n8n LINE Inbox Runbook

This runbook starts in dry-run only. Do not turn on LINE replies or auto-save without owner approval.

## 1. Site Environment

Required before n8n can call the Site endpoints:

```text
LINE_N8N_ENABLED=true
LINE_N8N_WORKER_SECRET=<store as Site secret>
LINE_N8N_DRY_RUN=true
LINE_N8N_AUTO_SAVE=false
LINE_N8N_LINE_REPLY=false
LINE_N8N_USE_AI=false
```

`LINE_INBOX_CRON_SECRET` can also authenticate these endpoints if already present. Do not put either secret in GitHub, n8n JSON exports, screenshots, logs, or chat.

## 2. n8n Credential

Create one n8n credential:

```text
Type: Header Auth
Name: VIGO4U Site Bearer Token
Header Name: Authorization
Header Value: Bearer <secret from secure store>
```

The workflow export uses a placeholder credential name only.

## 3. Import Workflow

Import:

```text
docs/n8n/line-inbox-dry-run-workflow.json
```

Keep workflow inactive first.

## 4. First Dry Run

1. Open workflow.
2. Confirm config:
   - `ACTIVE=false`
   - `DRY_RUN=true`
   - `AUTO_SAVE=false`
   - `LINE_REPLY=false`
   - `USE_AI=false`
3. Run `Health Check` manually.
4. If health is OK, temporarily set runtime `ACTIVE=true` in the Set node for a manual test run only.
5. Run manually.
6. Confirm:
   - Health returns queue counts.
   - Analyze pending returns processed/analyzed/error counts.
   - Queue summary returns messages.
   - Replay errors runs with `dry_run=true`.

## 5. Safe Schedule

After manual dry-run passes:

```text
Schedule: every 5 minutes
LIMIT: 10
USE_AI=false
AUTO_SAVE=false
LINE_REPLY=false
```

Leave the workflow inactive until owner says to activate.

## 6. What Must Not Happen Yet

- Do not change LINE OA production webhook to n8n.
- Do not enable `LINE_N8N_AUTO_SAVE=true`.
- Do not enable `LINE_N8N_LINE_REPLY=true`.
- Do not enable external AI for LINE content.
- Do not store secrets in workflow export.
- Do not delete or modify historical LINE rows manually.

## 7. Owner Approval Required

Owner approval is required before:

- Activating scheduled n8n workflow.
- Enabling auto-save.
- Enabling LINE replies.
- Sending LINE content to external AI.
- Moving LINE webhook away from ChatGPT Site.
- Opening ports or changing firewall on QNAP.

## 8. Rollback

Disable in this order:

1. Deactivate n8n workflow.
2. Set `LINE_N8N_ENABLED=false`.
3. Keep LINE OA webhook pointing at ChatGPT Site.
4. Staff can continue manual review in `/m/orders`.

No database rollback is required for dry-run because it only updates analyze fields; it does not create order items or send replies.
