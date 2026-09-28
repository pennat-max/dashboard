# Chang Joe n8n LINE Inbox Runbook

คู่มือนี้อธิบายว่า VIGO4U ใช้ n8n กับ LINE ยังไงในโหมดปลอดภัยก่อนเปิดใช้งานจริง
โดยค่าเริ่มต้นต้องเป็น dry-run เท่านั้น ห้ามเปิด auto-save หรือ LINE reply จริงโดยไม่มีอนุมัติจากเจ้าของระบบ

## สรุปการทำงานปัจจุบัน

```text
LINE OA / LINE group
-> ChatGPT Site /api/line/webhook
-> ตรวจ LINE signature
-> บันทึกข้อความ รูป และไฟล์ลง D1/R2
-> n8n บน QNAP/ช่างโจ้ดึงคิว pending
-> เรียก analyzer/parser เดิมของ Site
-> แยกผลเป็น พร้อมทำ / รอตรวจ / ติดปัญหา
-> พนักงานเปิดดูและแก้ใน /line-jobs-v2 ผ่าน LIFF
```

LINE webhook ยังต้องชี้มาที่ ChatGPT Site ไม่ใช่ n8n เพราะ Site เป็น public ingress ที่ตรวจลายเซ็นและเก็บไฟล์ได้แล้ว

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

ค่าเหล่านี้ต้องอยู่ใน Site secrets หรือ secret store เท่านั้น ไม่ใส่ใน Google Sheet, GitHub, n8n export, screenshot หรือ log

## 2. n8n Credential

Create one n8n credential:

```text
Type: Header Auth
Name: VIGO4U Site Bearer Token
Header Name: Authorization
Header Value: Bearer <secret from secure store>
```

The workflow export uses a placeholder credential name only.

## 3. Import Workflow เข้า n8n

Import:

```text
docs/n8n/line-inbox-dry-run-workflow.json
```

หลัง import ให้ตรวจทันที:

- workflow ต้อง inactive
- Runtime Guard ต้องเป็น `ACTIVE=false`
- `DRY_RUN=true`
- `AUTO_SAVE=false`
- `LINE_REPLY=false`
- `USE_AI=false`
- credential ต้องใช้ Header Auth ของ n8n ไม่ใส่ token ลง node โดยตรง

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

ถ้าเจอ `Unauthorized` ให้เช็กเฉพาะว่า credential ถูกผูกกับ HTTP Request node แล้วหรือยัง ห้าม print token ออก log

## 5. วิธีใช้งานจริงในแต่ละวัน

1. LINE OA รับข้อความจากกลุ่มตามปกติ
2. บอทตอบกลับใน LINE เป็นการ์ดหรือข้อความสั้นพร้อมปุ่ม/ลิงก์ดูรายละเอียดงาน
3. พนักงานกดเปิด LIFF หรือเข้า `/line-jobs-v2`
4. หน้าเว็บรวมข้อความ รูป งานที่ต้องทำ รถที่ระบบจับคู่ได้ และผู้รับผิดชอบ
5. พนักงานเปลี่ยนสถานะงานในเว็บ เช่น รอทำ, กำลังทำ, เสร็จ, ติดปัญหา, ยกเลิก
6. ระบบเก็บประวัติว่าใครเปลี่ยนสถานะและเปลี่ยนเมื่อไหร่
7. n8n ทำหน้าที่ดึงคิว pending และวิเคราะห์ซ้ำตามรอบที่ตั้งไว้

หลักสำคัญ: LINE ใช้รับงานเร็ว ส่วนรายละเอียดและการแก้ไขใช้ webapp/LIFF

## 6. Safe Schedule

After manual dry-run passes:

```text
Schedule: every 5 minutes
LIMIT: 10
USE_AI=false
AUTO_SAVE=false
LINE_REPLY=false
```

Leave the workflow inactive until owner says to activate.

เมื่อเจ้าของอนุมัติให้เริ่มงานจริงแบบ dry-run:

1. เปิด workflow ใน n8n
2. ตั้ง schedule ทุก 5 นาที
3. จำกัด `LIMIT=10` ก่อน
4. ตรวจ queue ใน `/line-jobs-v2`
5. ถ้าทำงานนิ่งแล้วค่อยเพิ่ม limit

ยังไม่ถือว่าเปิด production automation เต็มจนกว่า `AUTO_SAVE` และ `LINE_REPLY` จะได้รับอนุมัติแยก

## 7. What Must Not Happen Yet

- Do not change LINE OA production webhook to n8n.
- Do not enable `LINE_N8N_AUTO_SAVE=true`.
- Do not enable `LINE_N8N_LINE_REPLY=true`.
- Do not enable external AI for LINE content.
- Do not store secrets in workflow export.
- Do not delete or modify historical LINE rows manually.

## 8. Owner Approval Required

Owner approval is required before:

- Activating scheduled n8n workflow.
- Enabling auto-save.
- Enabling LINE replies.
- Sending LINE content to external AI.
- Moving LINE webhook away from ChatGPT Site.
- Opening ports or changing firewall on QNAP.

## 9. Rollback

Disable in this order:

1. Deactivate n8n workflow.
2. Set `LINE_N8N_ENABLED=false`.
3. Keep LINE OA webhook pointing at ChatGPT Site.
4. Staff can continue manual review in `/m/orders`.

No database rollback is required for dry-run because it only updates analyze fields; it does not create order items or send replies.

## 10. Troubleshooting

| อาการ | เช็กอะไร |
| --- | --- |
| หน้า `/line-jobs-v2` ไม่มีข้อมูล | เช็กว่า LINE webhook เข้า Site สำเร็จ และมี row ใหม่ใน line inbox |
| n8n ขึ้น Unauthorized | เช็ก Header Auth credential และ Site secret ว่ามีอยู่ แต่ห้ามแสดงค่า |
| งานซ้ำ | เช็ก event/message id และ idempotency ใน queue |
| รูปไม่ขึ้น | เช็ก R2 object และ file URL จาก `/api/files/...` |
| LINE ตอบแค่ข้อความ ไม่มีการ์ด | เช็ก LINE reply API error และ fallback text |
| Analyzer ไม่จับรถ | ให้พนักงานเปิดงานใน LIFF แล้วเลือก/แก้รถเองก่อน |

## 11. Current Production Notes

- Production UI หลัก: `https://vigo4u-operations.pennat.chatgpt.site`
- LINE Job Inbox: `/line-jobs-v2`
- LIFF ใช้เปิดหน้า `/line-jobs-v2` จาก LINE
- n8n ทำงานหลังบ้านแบบ pull pending queue
- ห้ามเปิด port/firewall เพิ่มบน QNAP โดยไม่มีอนุมัติ
- ห้ามใส่ secret ลง repo นี้
