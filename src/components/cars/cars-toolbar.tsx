import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  q?: string;
  status?: string;
  destination?: string;
  sort?: string;
  order?: string;
  statuses: string[];
  destinations: string[];
};

export function CarsToolbar({
  q = "",
  status = "all",
  destination = "all",
  sort = "updated_at",
  order = "desc",
  statuses,
  destinations,
}: Props) {
  return (
    <form className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end" method="get">
      <div className="grid w-full gap-2 sm:max-w-xs">
        <Label htmlFor="q">ค้นหา</Label>
        <Input
          id="q"
          name="q"
          placeholder="ยี่ห้อ รุ่น เลขถัง ทะเบียน"
          defaultValue={q}
        />
      </div>
      <div className="grid w-full gap-2 sm:max-w-[200px]">
        <Label htmlFor="status">สถานะ</Label>
        <select
          id="status"
          name="status"
          defaultValue={status}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">ทั้งหมด</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="grid w-full gap-2 sm:max-w-[200px]">
        <Label htmlFor="destination">ปลายทาง</Label>
        <select
          id="destination"
          name="destination"
          defaultValue={destination}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">ทั้งหมด</option>
          {destinations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="grid w-full gap-2 sm:max-w-[200px]">
        <Label htmlFor="sort">เรียงตาม</Label>
        <select
          id="sort"
          name="sort"
          defaultValue={sort}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="updated_at">อัปเดตล่าสุด</option>
          <option value="income_date">วันที่รับรถ</option>
          <option value="id">รหัส</option>
          <option value="brand">ยี่ห้อ</option>
          <option value="model">รุ่น</option>
          <option value="buy_price">ราคา</option>
          <option value="mileage">เลขไมล์</option>
        </select>
      </div>
      <div className="grid w-full gap-2 sm:max-w-[140px]">
        <Label htmlFor="order">ลำดับ</Label>
        <select
          id="order"
          name="order"
          defaultValue={order}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="desc">มาก → น้อย</option>
          <option value="asc">น้อย → มาก</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit">ใช้ตัวกรอง</Button>
        <Link href="/cars" className={buttonVariants({ variant: "outline" })}>
          ล้าง
        </Link>
      </div>
    </form>
  );
}
