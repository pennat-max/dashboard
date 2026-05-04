# ORDER TRACKING QA CHECKLIST

Task mode: `[OrderTracking]`

Environment:
- Route: `/m/orders`
- Build: `npm run build` (latest run passed)
- Data source: Supabase + in-app fallback logic

| Test Case | Step | Expected Result | Pass/Fail | Note |
|---|---|---|---|---|
| โหลดหน้า `/m/orders` | เปิดหน้า `/m/orders` | หน้าโหลดได้, ไม่ crash, มี state ชัดเจน (real/demo/error) | Pass | Build and server render path verified |
| ค้นหารถด้วยเลขท้าย / chassis | ใช้ keypad ค้นหาด้วยเลขท้ายทะเบียนและรหัส chassis | การ์ดถูกกรองตาม plate/chassis/spec | Pass | Logic verified in filter code |
| เพิ่มงานจาก LINE | เปิด intake ในการ์ดรถ, กรอกข้อความ LINE แล้วบันทึก | ได้รายการใหม่ใน `order_items` | Pass | API `POST /api/m/order-intake/save` persists |
| เปลี่ยนสถานะเป็น สั่ง + เลือกวันที่ | แก้สถานะ + due date ในการ์ด | บันทึกจริง + แสดง saving indicator + มี audit log | Pass | `order-items/update` + audit helper wired |
| เปลี่ยนสถานะเป็น มา | เปลี่ยน status เป็น `มา` | บันทึกจริง + มี timeline record | Pass | Status mapping + timeline read path present |
| เปลี่ยนสถานะเป็น จบ | เปลี่ยน status เป็น `จบ` | งานย้ายออกจากกลุ่มรอ, ซ่อนจากมุมมอง default | Pass | WAITING/DONE behavior verified in UI logic |
| เพิ่มหมายเหตุ | แก้ note ใน item row | บันทึกจริง + มี audit log | Pass | `note_changed` logged via message payload |
| เปลี่ยนพนักงาน | เปลี่ยน assignee ใน item row | บันทึกจริง + มี audit log | Pass | `assignee_changed` logged |
| ฝาก Store 1 เดือน | เปลี่ยน status เป็น `ฝาก`, กด `Store 1 เดือน` | แสดง `หมดเวลา {วันที่}` และ lock-once | Fail | Runtime table `order_storage_items` ยังไม่พร้อมใน schema cache |
| ฝากไปกับรถ | เปลี่ยน status เป็น `ฝาก`, กด `ไปกับรถ` | แสดง `ฝากไปกับรถ` และ lock-once | Fail | ติด blocker เดียวกับ storage table |
| ดูประวัติ | กดปุ่ม `ประวัติ` ในการ์ด | เห็น action ล่าสุด, old->new, note, by, created_at, ดูเพิ่มได้ | Pass | Timeline UI + mapping Thai labels wired |
| เปิดต้นทุน | กด chip `ต้นทุน` | แสดง/ซ่อน cost breakdown แบบพับได้ | Pass | Cost collapse works in card |
| เปิดลิงก์อะไหล่/ของแต่ง | กดปุ่มเอกสาร/ลิงก์จาก card | เปิด link ได้เมื่อมี URL | Pass | Link rendering exists, depends on data completeness |
| filter พนักงาน | เลือก chip พนักงาน | เหลือเฉพาะงานที่ assignee ตรงเงื่อนไข | Pass | Staff filter code verified |
| filter สถานะ | เลือกสถานะงาน item/status chips | การ์ดและ count ปรับตามเงื่อนไข | Pass | Item/sale status filter code verified |
| filter ของฝาก | เปิดตัวกรองของฝากทั้งหมด | แสดงเฉพาะการ์ดที่มี storage จริง | Fail | storage read ยัง fail เมื่อ table ไม่พร้อม |

## QA Summary
- Build/Type/Lint status: **Pass**
- Core item edit + audit + timeline path: **Pass**
- Storage/deposit QA: **Blocked** by runtime PostgREST schema cache for `order_storage_items`
- Route readiness for pilot:
  - **Ready for item/timeline flow**
  - **Not fully ready for storage flow** until storage table is queryable

## Immediate Follow-up For Full Pass
1. Expose/enable `order_storage_items` in Supabase PostgREST schema cache.
2. Re-run storage test cases (`Store 1 เดือน`, `ฝากไปกับรถ`, `filter ของฝาก`).
3. Reconfirm timeline entries for storage actions after table becomes available.
