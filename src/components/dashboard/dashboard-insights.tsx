import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BuyerCount, ModelYearInsight } from "@/lib/data/aggregate";
import { Users } from "lucide-react";

type Props = {
  byBuyer: BuyerCount[];
  modelYear: ModelYearInsight | null;
};

export function DashboardInsights({ byBuyer, modelYear }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border border-border/80 bg-card shadow-sm">
        <CardHeader className="border-b border-border/80 pb-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
              <Users className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base font-semibold">ขายให้ใคร (ตาม buyer)</CardTitle>
              <CardDescription>
                แถวที่มีชื่อใน <code className="rounded border border-border bg-muted px-1 font-mono text-[0.7rem]">buyer</code>{" "}
                — เรียงจำนวนคันจากมากไปน้อย
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {byBuyer.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              ยังไม่มีข้อมูลผู้ซื้อในคอลัมน์ buyer
            </p>
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
                    <TableHead className="font-medium">ผู้ซื้อ</TableHead>
                    <TableHead className="w-28 text-end font-medium">จำนวน (คัน)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byBuyer.map((row) => (
                    <TableRow key={row.buyer} className="border-border/80">
                      <TableCell className="font-medium">{row.buyer}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {new Intl.NumberFormat("th-TH").format(row.count)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/80 bg-card shadow-sm">
        <CardHeader className="border-b border-border/80 pb-4">
          <CardTitle className="text-base font-semibold">Model year ที่ขายดี</CardTitle>
          <CardDescription>
            จากรถที่ถือว่า &quot;ขาย/ดีลปิด&quot; — ปีที่มีจำนวนมากสุด และคันที่ยังไม่ปิดดีลในปีเดียวกัน
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {!modelYear ? (
            <p className="text-sm text-muted-foreground">
              ยังไม่มีข้อมูลเพียงพอสำหรับจัดอันดับปี
            </p>
          ) : (
            <>
              <dl className="grid gap-4 rounded-md border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
                  <dt className="text-sm text-muted-foreground">ปีที่ขายมากสุด</dt>
                  <dd className="font-heading text-2xl font-semibold tabular-nums text-foreground">
                    {modelYear.topYear}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-sm text-muted-foreground">จำนวนที่ขาย/ปิดดีล (ปีนี้)</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {new Intl.NumberFormat("th-TH").format(modelYear.soldCount)} คัน
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3">
                  <dt className="text-sm text-muted-foreground">เหลือในสต็อก (ปีเดียวกัน)</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">
                    {new Intl.NumberFormat("th-TH").format(modelYear.remainingInStock)} คัน
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed text-muted-foreground">
                ปีมาจาก c_year / model_year — กลุ่ม &quot;ไม่ระบุปี&quot; หากไม่มีข้อมูล
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
