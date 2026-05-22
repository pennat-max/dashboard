"use client";

import Link from "next/link";
import { buildExportInquiryPrefill } from "@/lib/marketplace/build-export-inquiry-message";
import { exportGuestCopy, type ExportGuestUiLang } from "@/lib/marketplace/export-guest-copy";
import { buildWaMeUrl, getExportWhatsAppDigits } from "@/lib/marketplace/whatsapp-wa-me";
import { cn } from "@/lib/utils";

export type GuestMarketplaceExportOrderBits = {
  id: string;
  car: string;
  chassis: string;
  fullPlate: string;
  sale: string;
};

export function GuestMarketplaceExportDetailBlocks({
  uiLang,
}: {
  uiLang: ExportGuestUiLang;
}) {
  const copy = exportGuestCopy(uiLang);
  return (
    <div className="mt-5 space-y-6 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
          {copy.exportOnlyBadge}
        </span>
        <span className="text-xs font-semibold text-slate-500">{copy.listingSectionExport}</span>
      </div>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{copy.termsTitle}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-700">{copy.termsIntro}</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[14px] leading-relaxed text-slate-700">
          {copy.termsBullets.map((b) => (
            <li key={b.slice(0, 48)}>{b}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{copy.stepsTitle}</h3>
        <ol className="mt-3 space-y-3">
          {copy.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 text-[14px] leading-snug text-slate-800">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                {i + 1}
              </span>
              <span>
                <span className="font-semibold text-slate-900">{s.title}</span>
                <span className="text-slate-600"> — {s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{copy.faqTitle}</h3>
        <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/60">
          {copy.faq.map((item) => (
            <details key={item.q} className="group px-3 py-1">
              <summary className="cursor-pointer list-none py-2 text-[14px] font-medium text-slate-900 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="mr-1 inline-block text-slate-400 transition-transform group-open:rotate-90">›</span>
                {item.q}
              </summary>
              <p className="pb-2 pl-4 text-[13px] leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="text-[12px] leading-relaxed text-slate-500">{copy.disclaimer}</p>
    </div>
  );
}

export function GuestMarketplaceExportStickyBar({
  order,
  uiLang,
  priceLabel,
  carTitleDisplay,
  vigoDetailsUrl,
}: {
  order: GuestMarketplaceExportOrderBits;
  uiLang: ExportGuestUiLang;
  priceLabel: string;
  carTitleDisplay: string;
  vigoDetailsUrl: string | null;
}) {
  const copy = exportGuestCopy(uiLang);
  const digits = getExportWhatsAppDigits();
  const msg = buildExportInquiryPrefill({
    orderId: order.id,
    vehicleTitle: carTitleDisplay || order.car,
    listedPriceLabel: priceLabel,
    chassis: order.chassis,
    fullPlate: order.fullPlate,
    saleCode: order.sale,
  });
  const waUrl = digits ? buildWaMeUrl(digits, msg) : null;

  return (
    <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {waUrl ? (
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-sm font-semibold text-white shadow-sm touch-manipulation active:brightness-95"
        >
          <span aria-hidden>💬</span>
          {copy.whatsappCta}
        </a>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs leading-snug text-amber-950">{copy.missingWhatsapp}</p>
      )}

      <div className={cn("grid gap-2", vigoDetailsUrl ? "grid-cols-2" : "grid-cols-1")}>
        <Link
          href={uiLang === "en" ? "/m/export-info?lang=en" : "/m/export-info"}
          className="flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 touch-manipulation active:bg-slate-50"
        >
          {copy.howItWorks}
        </Link>
        {vigoDetailsUrl ? (
          <a
            href={vigoDetailsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-900 text-center text-xs font-semibold leading-tight text-white touch-manipulation active:bg-slate-800"
          >
            {uiLang === "en" ? "View on Vigoasia" : "ดูหน้าขายบน Vigoasia"}
          </a>
        ) : null}
      </div>
    </div>
  );
}
