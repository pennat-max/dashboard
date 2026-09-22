import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  carDestinationLabel,
  carPriceNumber,
  carTitleLine,
  modelYearDisplay,
} from "@/lib/car-fields";
import { formatKm, formatThb } from "@/lib/format";
import type { Car } from "@/types/car";
import { ChevronRight } from "lucide-react";

function statusVariant(
  status: string | null | undefined
): "default" | "secondary" | "outline" | "destructive" {
  const s = (status ?? "").toLowerCase();
  if (s.includes("office") || s.includes("available") || s.includes("stock"))
    return "secondary";
  if (s.includes("sold") || s.includes("shipped") || s.includes("cancel"))
    return "outline";
  if (s.includes("reserved") || s.includes("จอง")) return "default";
  return "outline";
}

export function CarsTable({ cars }: { cars: Car[] }) {
  if (cars.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-emerald-300/60 bg-tone-emerald/40 p-10 text-center text-sm text-muted-foreground dark:border-emerald-500/30">
        ไม่พบข้อมูลรถ — ลองปรับคำค้นหาหรือตัวกรอง
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border-2 border-emerald-200/80 bg-card/90 shadow-md shadow-emerald-500/5 dark:border-emerald-500/25">
      <Table>
        <TableHeader>
          <TableRow className="border-emerald-500/15 bg-emerald-500/[0.07] hover:bg-emerald-500/[0.07] dark:bg-emerald-500/10">
            <TableHead className="min-w-[140px] text-emerald-950 dark:text-emerald-100">
              ยี่ห้อ / รุ่น
            </TableHead>
            <TableHead className="whitespace-nowrap text-emerald-950 dark:text-emerald-100">ปี</TableHead>
            <TableHead className="whitespace-nowrap text-emerald-950 dark:text-emerald-100">เลขไมล์</TableHead>
            <TableHead className="whitespace-nowrap text-emerald-950 dark:text-emerald-100">ราคา</TableHead>
            <TableHead className="min-w-[100px] text-emerald-950 dark:text-emerald-100">สถานะ</TableHead>
            <TableHead className="min-w-[100px] text-emerald-950 dark:text-emerald-100">ปลายทาง</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {cars.map((car, rowIdx) => (
            <TableRow
              key={String(car.id)}
              className={rowIdx % 2 === 1 ? "bg-emerald-500/[0.03] dark:bg-emerald-500/[0.04]" : undefined}
            >
              <TableCell>
                <div className="font-medium">{carTitleLine(car)}</div>
                {(car.plate_number || car.stock_code) && (
                  <div className="text-xs text-muted-foreground">
                    {car.plate_number ?? car.stock_code}
                  </div>
                )}
              </TableCell>
              <TableCell className="tabular-nums">{modelYearDisplay(car)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatKm(car.mileage ?? car.mileage_km)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatThb(carPriceNumber(car))}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(car.status)}>{car.status ?? "—"}</Badge>
              </TableCell>
              <TableCell>{carDestinationLabel(car) ?? "—"}</TableCell>
              <TableCell>
                <Link
                  href={`/cars/${car.row_id ?? car.id}`}
                  className="inline-flex size-8 items-center justify-center rounded-md text-emerald-700/80 hover:bg-emerald-500/15 hover:text-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                  aria-label={`รายละเอียด ${car.id}`}
                >
                  <ChevronRight className="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
