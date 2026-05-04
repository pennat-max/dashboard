/**
 * ค่า `order_items.status` ต้องผ่าน check constraint (ดู supabase/order-tracking-phase1.sql)
 */
export function itemStatusForOrderItemsRow(status: string | undefined): string {
  const s = (status ?? "").trim();
  switch (s) {
    case "เช็ค":
    case "มี":
    case "ต้องสั่ง":
    case "สั่ง":
    case "มา":
    case "รถนอก":
    case "ช่างนอก":
    case "จบ":
    case "ฝากกับรถ":
      return s;
    case "ฝากสโตร์":
    case "ฝากสโสร์":
      return "ฝากสโตร์";
    /** เก่า: ชื่อใน DB เดิม */
    case "ฝากรถ":
      return "ฝากกับรถ";
    case "deposit_store":
      return "ฝากสโตร์";
    case "deposit_in_car":
    case "in_car_storage":
      return "ฝากกับรถ";
    /** เคสกว้าง ๆ ไม่ระบุแหล่งฝาก */
    case "ฝาก":
    case "deposit":
    case "stored":
      return "เช็ค";
    case "requested":
    case "stock_check":
    case "ordering":
    case "received":
    case "pickup":
    case "installing":
    case "done":
    case "cancelled":
      return s;
    case "ordered":
      return "สั่ง";
    case "ready":
      return "มี";
    default:
      return "requested";
  }
}
