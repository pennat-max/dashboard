import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary } from "@/i18n/dictionaries";
import type { DashboardKpi } from "@/lib/data/cars";
import { formatThb } from "@/lib/format";
import type { Locale } from "@/lib/locale-constants";
import { numberFormatLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { Bookmark, CarFront, CalendarDays, Globe, Package, Ship } from "lucide-react";

type Props = {
  kpi: DashboardKpi;
  locale: Locale;
  kpiDict: Dictionary["kpi"];
};

export function KpiCards({ kpi, locale, kpiDict }: Props) {
  const nf = numberFormatLocale(locale);
  const fmt = (n: number) => new Intl.NumberFormat(nf).format(n);

  const items = [
    {
      title: kpiDict.totalCars,
      value: fmt(kpi.totalCars),
      icon: CarFront,
      href: "/cars",
      linkLabel: kpiDict.totalCars,
      toneClass: "before:from-tone-sky/45 before:via-tone-sky/10 before:to-transparent",
      iconTone: "border-chart-1/30 bg-chart-1/12 text-chart-1",
      valueTone: "text-chart-1",
    },
    {
      title: kpiDict.exported,
      value: fmt(kpi.exportedCount),
      icon: Ship,
      href: "/dashboard/exported",
      linkLabel: kpiDict.exported,
      toneClass: "before:from-tone-emerald/45 before:via-tone-emerald/10 before:to-transparent",
      iconTone: "border-chart-2/30 bg-chart-2/12 text-chart-2",
      valueTone: "text-chart-2",
    },
    {
      title: kpiDict.booked,
      value: fmt(kpi.bookedNotExportedCount),
      icon: Bookmark,
      href: "/dashboard/booked",
      linkLabel: kpiDict.bookedLink,
      toneClass: "before:from-tone-amber/45 before:via-tone-amber/10 before:to-transparent",
      iconTone: "border-chart-3/30 bg-chart-3/12 text-chart-3",
      valueTone: "text-chart-3",
    },
    {
      title: kpiDict.available,
      value: fmt(kpi.availableCount),
      icon: Package,
      href: "/dashboard/available",
      linkLabel: kpiDict.available,
      toneClass: "before:from-tone-violet/45 before:via-tone-violet/10 before:to-transparent",
      iconTone: "border-chart-4/30 bg-chart-4/12 text-chart-4",
      valueTone: "text-chart-4",
    },
    {
      title: kpiDict.incomeTomorrow,
      value: `${formatThb(kpi.incomeTomorrowValueThb)} · ${fmt(kpi.incomeTomorrowCount)} ${kpiDict.unitsCars}`,
      icon: CalendarDays,
      href: "/dashboard/income-schedule",
      linkLabel: kpiDict.incomeTomorrow,
      toneClass: "before:from-tone-cyan/45 before:via-tone-cyan/10 before:to-transparent",
      iconTone: "border-chart-2/30 bg-chart-2/12 text-chart-2",
      valueTone: "text-chart-2",
    },
    {
      title: kpiDict.websitePending,
      value: fmt(kpi.websitePendingCount),
      icon: Globe,
      href: "/dashboard/website-pending",
      linkLabel: kpiDict.websitePending,
      toneClass: "before:from-tone-rose/45 before:via-tone-rose/10 before:to-transparent",
      iconTone: "border-chart-5/30 bg-chart-5/12 text-chart-5",
      valueTone: "text-chart-5",
    },
    {
      title: kpiDict.websitePendingBeForward,
      value: fmt(kpi.websitePendingBeForwardCount),
      icon: Globe,
      href: "/dashboard/website-pending-beforward",
      linkLabel: kpiDict.websitePendingBeForward,
      toneClass: "before:from-tone-fuchsia/45 before:via-tone-fuchsia/10 before:to-transparent",
      iconTone: "border-chart-1/30 bg-chart-1/12 text-chart-1",
      valueTone: "text-chart-1",
    },
  ] as const;

  return (
    <div className="kpi-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {items.map(({ title, value, icon: Icon, href, linkLabel, toneClass, iconTone, valueTone }) => {
        const card = (
          <Card
            size="sm"
            className={cn(
              "relative overflow-hidden border border-border/80 bg-card shadow-sm transition-all duration-200",
              "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r",
              toneClass,
              href
                ? "h-full cursor-pointer group-hover:border-primary/45 group-hover:-translate-y-0.5 group-hover:shadow-md"
                : "hover:-translate-y-0.5 hover:shadow-md"
            )}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2 pt-4">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-xs font-medium leading-snug text-muted-foreground">{title}</CardTitle>
              </div>
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border", iconTone)}>
                <Icon className="size-4" aria-hidden />
              </span>
            </CardHeader>
            <CardContent className="pt-0">
              <p
                className={cn(
                  "font-heading text-3xl md:text-4xl font-semibold tabular-nums leading-none tracking-tight",
                  valueTone
                )}
              >
                {value}
              </p>
            </CardContent>
          </Card>
        );

        if (href) {
          return (
            <Link
              key={title}
              href={href}
              className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={linkLabel ?? title}
            >
              {card}
            </Link>
          );
        }

        return (
          <div key={title} className="rounded-xl">
            {card}
          </div>
        );
      })}
    </div>
  );
}
