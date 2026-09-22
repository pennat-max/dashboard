import { redirect } from "next/navigation";

/** ลิงก์เก่า — ส่งกลับไปหน้ารายการคำสั่งงานหลัก */
export default function UrgentLineIntakeRedirectPage() {
  redirect("/m/orders");
}
