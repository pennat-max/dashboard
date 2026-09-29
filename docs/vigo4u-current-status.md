# VIGO4U Current Status

Last verified: 2026-09-29 11:20 Asia/Bangkok

ไฟล์นี้คือจุดอ่านหลักเวลาใช้ Codex หลายเครื่อง ถ้างงว่า Production ไปถึงไหนแล้ว ให้เริ่มจากไฟล์นี้ก่อน แล้วค่อยอ่าน runbook เฉพาะเรื่อง

## Source Of Truth

- Production: `https://vigo4u-operations.pennat.chatgpt.site`
- Main staff LINE jobs page: `/line-jobs-v2`
- Legacy/older LINE jobs page: `/line-jobs`
- LIFF ID: `2009973514-VUSvnNgg`
- GitHub repo: `pennat-max/dashboard`
- Site project ID: `appgprj_6a97f2d6ef008191b31ab4e92f5a597d`
- Current deployed source commit verified in this workspace: `73ada88 Shorten LINE receipt card`

## Current Architecture

```text
LINE group / LINE OA
-> ChatGPT Site /api/line/webhook
-> verify LINE signature
-> store message/photo/file data in D1/R2
-> immediate LINE acknowledgement card
-> staff opens LIFF /line-jobs-v2
-> staff reviews, edits, and changes job status
-> n8n can pull/analyze pending queue through Site APIs
```

ChatGPT Site is still the public LINE webhook ingress. Do not point LINE webhook directly to n8n unless a new approved cutover plan says so.

## What Is Live Now

- ChatGPT Site is live and returns 200 for `/line-jobs-v2`.
- LIFF config returns `2009973514-VUSvnNgg`.
- LINE receipt reply is enabled.
- Receipt reply card is intentionally short:
  - title: received job
  - plate if detected
  - mileage if detected
  - button: view job details
  - chassis is not shown in the LINE card
- `/line-jobs-v2` is the intended mobile-first staff page.
- n8n Site API endpoints exist:
  - `/api/n8n/line-inbox/health`
  - `/api/n8n/line-inbox/pending-queue`
  - `/api/n8n/line-inbox/analyze-pending`
  - `/api/n8n/line-inbox/replay-errors`

## Production Flags Observed

These are runtime flags observed from Sites on 2026-09-29. Secret values were not read or written.

```text
LINE_WEBHOOK_RECEIPT_REPLY_ENABLED=true
LINE_AUTO_SAVE_ENABLED=true
LINE_AUTO_SAVE_DRY_RUN_ENABLED=false
LINE_AUTO_SAVE_REPLY_ENABLED=true
LINE_N8N_ENABLED=true
LINE_N8N_DRY_RUN=false
LINE_N8N_AUTO_SAVE=true
LINE_N8N_LINE_REPLY=true
LINE_N8N_USE_AI=true
OPEN_ORDER_TRACKING_MUTATIONS=false
SHEET_SYNC_WRITE_ENABLED=true
```

Important: Production flags are not in dry-run mode. If a safer test mode is needed, change the flags first and redeploy/restart as required by Sites.

## What To Use

For staff:

```text
https://vigo4u-operations.pennat.chatgpt.site/line-jobs-v2
```

For LINE links:

```text
https://liff.line.me/2009973514-VUSvnNgg
```

For n8n:

- Keep n8n calling ChatGPT Site APIs.
- Use Header Auth bearer credential stored in n8n credentials only.
- Do not store tokens in workflow JSON.
- Use `docs/n8n/line-inbox-dry-run-workflow.json` only as an import template, not as proof of current Production flags.

## Current Docs

- n8n runbook: `docs/line-n8n-chang-joe-runbook.md`
- n8n architecture plan: `docs/line-n8n-chang-joe-plan.md`
- n8n import template: `docs/n8n/line-inbox-dry-run-workflow.json`
- LINE bridge audit: `docs/line-bridge-audit.md`

## Known Workspace Note

There is an untracked local file:

```text
scripts/n8n-local-proxy.cjs
```

It was not included in the status commits and should not be assumed to exist in GitHub unless intentionally added later.

## Handoff Rule For Future Codex Sessions

When a new Codex machine starts work:

1. Pull GitHub.
2. Read this file first.
3. Check `git log -5 --oneline`.
4. Check Sites env flags if changing LINE/n8n behavior.
5. Do not trust chat history over repo + live verification.
