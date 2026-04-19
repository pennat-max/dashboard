import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import {
  carDestinationLabel,
  carPriceNumber,
  carStockLabel,
  carTitleLine,
} from "@/lib/car-fields";
import { fetchCarById } from "@/lib/data/cars";
import { formatDate, formatKm, formatThb } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageProps = { params: { id: string } };

function str(v: unknown): string {
  if (v == null) return "—";
  const s = String(v).trim();
  return s || "—";
}

type DetailSection = {
  title: string;
  subtitle: string;
  tone: "sky" | "emerald" | "violet" | "amber";
  rows: { label: string; value: string }[];
};

const sectionToneClass: Record<DetailSection["tone"], string> = {
  sky: "border-sky-200/90 bg-tone-sky/55 shadow-sky-500/10 dark:border-sky-500/30 dark:bg-tone-sky/35",
  emerald:
    "border-emerald-200/90 bg-tone-emerald/55 shadow-emerald-500/10 dark:border-emerald-500/30 dark:bg-tone-emerald/35",
  violet:
    "border-violet-200/90 bg-tone-violet/55 shadow-violet-500/10 dark:border-violet-500/30 dark:bg-tone-violet/35",
  amber:
    "border-amber-200/90 bg-tone-amber/55 shadow-amber-500/10 dark:border-amber-500/30 dark:bg-tone-amber/35",
};

const sectionAccentClass: Record<DetailSection["tone"], string> = {
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
};

function DetailSectionBlock({ section }: { section: DetailSection }) {
  return (
    <section
      className={cn(
        "rounded-2xl border-2 p-5 shadow-md backdrop-blur-sm md:p-6",
        sectionToneClass[section.tone]
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn("mt-1 h-10 w-1 shrink-0 rounded-full", sectionAccentClass[section.tone])}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-heading text-base font-semibold tracking-tight">{section.title}</h2>
          <p className="text-xs text-muted-foreground">{section.subtitle}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-0">
        {section.rows.map((row, i) => (
          <div key={row.label}>
            {i > 0 && <Separator className="my-3 opacity-60" />}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="text-sm font-medium sm:text-end">{row.value}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function CarDetailPage({ params }: PageProps) {
  const { id } = params;
  const { car, error } = await fetchCarById(id);
  if (error) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <SupabaseErrorBanner message={error} />
        <Link href="/cars" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
          กลับไปรายการ
        </Link>
      </div>
    );
  }
  if (!car) {
    notFound();
  }

  const title = carTitleLine(car);
  const stock = carStockLabel(car);

  const allRows: { label: string; value: string }[] = [
    { label: "รายละเอียด (Spec)", value: str(car.spec) },
    { label: "ยี่ห้อ", value: str(car.brand ?? car.make) },
    { label: "รุ่น", value: str(car.model) },
    { label: "Model year", value: str(car.model_year) },
    { label: "ทะเบียน", value: str(car.plate_number ?? car.stock_code) },
    { label: "จังหวัด", value: str(car.province) },
    { label: "สี", value: str(car.color) },
    {
      label: "Drive / Grade",
      value: [car.drive_type, car.engine_size, car.grade].filter(Boolean).join(" · ") || "—",
    },
    { label: "เกียร์", value: str(car.gear_type ?? car.transmission) },
    { label: "เลขไมล์", value: formatKm(car.mileage ?? car.mileage_km) },
    { label: "ราคาซื้อ", value: formatThb(carPriceNumber(car)) },
    { label: "สถานะ", value: str(car.status) },
    { label: "ประเทศ / ปลายทาง", value: str(carDestinationLabel(car)) },
    { label: "ท่า / Port", value: str(car.destination_port) },
    { label: "Shipped", value: str(car.shipped) },
    { label: "เลขถัง", value: str(car.chassis_number ?? car.vin) },
    { label: "เลขเครื่อง", value: str(car.engine_number) },
    { label: "วันรับรถ", value: formatDate(car.income_date) },
    { label: "วันจอง/Advance", value: formatDate(car.advance_date) },
    { label: "อัปเดตล่าสุด", value: formatDate(car.updated_at) },
  ];

  const sections: DetailSection[] = [
    {
      title: "ข้อมูลรถ",
      subtitle: "โทนฟ้า — ยี่ห้อ รุ่น สเปก และสภาพ",
      tone: "sky",
      rows: allRows.slice(0, 10),
    },
    {
      title: "ราคาและสถานะ",
      subtitle: "โทนเขียว — การค้าและสต็อก",
      tone: "emerald",
      rows: allRows.slice(10, 15),
    },
    {
      title: "เลขตัวถัง / เครื่อง",
      subtitle: "โทนม่วง — ตัวระบุยานพาหนะ",
      tone: "violet",
      rows: allRows.slice(15, 17),
    },
    {
      title: "วันที่สำคัญ",
      subtitle: "โทนอำพัน — ไทม์ไลน์",
      tone: "amber",
      rows: allRows.slice(17),
    },
  ];

  const picture = car.picture ?? car.image_url;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-400 via-amber-400 to-sky-500"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/cars"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "-ml-2 mb-2 inline-flex gap-1 text-muted-foreground hover:text-foreground"
              )}
            >
              <ArrowLeft className="size-4" />
              กลับไปรายการ
            </Link>
            <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {car.status && (
                <Badge variant="secondary" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100">
                  {car.status}
                </Badge>
              )}
              {stock && <span className="text-sm text-muted-foreground">{stock}</span>}
            </div>
          </div>
        </div>
      </section>

      {picture && (
        <div className="overflow-hidden rounded-2xl border-2 border-violet-200/70 bg-muted shadow-md shadow-violet-500/10 dark:border-violet-500/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={picture} alt={title} className="aspect-video w-full object-cover" />
        </div>
      )}

      <div className="grid gap-6">
        {sections.map((s) => (
          <DetailSectionBlock key={s.title} section={s} />
        ))}
      </div>

      <div>
        <Link href="/cars" className={buttonVariants({ variant: "outline" })}>
          ดูรายการทั้งหมด
        </Link>
      </div>
    </div>
  );
}
