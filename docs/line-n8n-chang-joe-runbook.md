# Chang Joe n8n LINE Inbox Runbook

This runbook reflects the owner-approved production behavior: matched cars auto-save, unmatched cars appear only in the problem drawer, and saved jobs receive one LINE completion reply.

## 1. Site Environment

Required before n8n can call the Site endpoints:

```text
LINE_N8N_ENABLED=true
LINE_N8N_WORKER_SECRET=<store as Site secret>
LINE_N8N_DRY_RUN=false
LINE_N8N_AUTO_SAVE=true
LINE_N8N_LINE_REPLY=true
LINE_N8N_USE_AI=true
LINE_AUTO_SAVE_ENABLED=true
LINE_AUTO_SAVE_DRY_RUN_ENABLED=false
LINE_AUTO_SAVE_REPLY_ENABLED=true
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

Import the workflow and bind every HTTP Request node to the `VIGO4U Site Bearer Token` credential. Activate it after the manual health check succeeds.

## 4. First Production Check

1. Open workflow.
2. Confirm config:
   - `ACTIVE=true`
   - `DRY_RUN=false`
   - `AUTO_SAVE=true`
   - `LINE_REPLY=true`
   - `USE_AI=true`
3. Run `Health Check` manually and confirm all production flags are true except dry-run.
4. Run the complete workflow manually once.
5. Activate the workflow.
6. Confirm:
   - Health returns queue counts.
   - Analyze pending returns processed/analyzed/error counts.
   - Queue summary returns messages.
   - Error inspection runs with `dry_run=true` and does not create a retry loop.

## 5. Production Schedule

After the manual production check passes:

```text
Schedule: every 1 minute
LIMIT: 20
USE_AI=true
AUTO_SAVE=true
LINE_REPLY=true
```

The owner has approved activation for this LINE order-tracking workflow.

## 6. Guardrails

- Do not change LINE OA production webhook to n8n.
- Do not store secrets in workflow export.
- Do not delete or modify historical LINE rows manually.
- Do not automatically reset the same analyze error every minute.
- Do not send review/problem messages repeatedly to the LINE group; unmatched rows belong in the problem drawer.

## 7. Separate Approval Still Required

Separate approval is still required before:

- Moving LINE webhook away from ChatGPT Site.
- Opening ports or changing firewall on QNAP.

## 8. Rollback

Disable in this order:

1. Deactivate n8n workflow.
2. Set `LINE_N8N_ENABLED=false`.
3. Keep LINE OA webhook pointing at ChatGPT Site.
4. Staff can continue manual review in `/m/orders`.

Deactivating the workflow stops future scheduled processing. Work already saved in Order Tracking is not rolled back automatically.
