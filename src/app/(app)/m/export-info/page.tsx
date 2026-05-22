import Link from "next/link";
import { exportGuestCopy, type ExportGuestUiLang } from "@/lib/marketplace/export-guest-copy";

export const metadata = {
  title: "ส่งออก — วิธีซื้อ",
};

type PageProps = {
  searchParams?: { lang?: string | string[] };
};

function resolveLang(raw: unknown): ExportGuestUiLang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return String(v ?? "").toLowerCase() === "en" ? "en" : "th";
}

export default function ExportInfoPage({ searchParams }: PageProps) {
  const lang = resolveLang(searchParams?.lang);
  const copy = exportGuestCopy(lang);

  return (
    <div className="mx-auto max-w-lg px-4 py-6 pb-12 text-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/m/orders"
          className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          {copy.backToListings}
        </Link>
        <div className="flex gap-1 rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
          <Link
            href="/m/export-info"
            className={lang === "th" ? "rounded-full bg-white px-2.5 py-1 shadow-sm" : "rounded-full px-2.5 py-1 text-slate-600"}
          >
            {copy.langLabelTh}
          </Link>
          <Link
            href="/m/export-info?lang=en"
            className={lang === "en" ? "rounded-full bg-white px-2.5 py-1 shadow-sm" : "rounded-full px-2.5 py-1 text-slate-600"}
          >
            {copy.langLabelEn}
          </Link>
        </div>
      </div>

      <h1 className="text-xl font-bold leading-snug">{copy.pageTitle}</h1>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
          {copy.exportOnlyBadge}
        </span>
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">{copy.termsTitle}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{copy.termsIntro}</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[15px] leading-relaxed text-slate-700">
          {copy.termsBullets.map((b) => (
            <li key={b.slice(0, 64)}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">{copy.stepsTitle}</h2>
        <ol className="mt-3 space-y-3">
          {copy.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 text-[15px] leading-snug text-slate-800">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
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

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">{copy.faqTitle}</h2>
        <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/60">
          {copy.faq.map((item) => (
            <details key={item.q} className="group px-3 py-1">
              <summary className="cursor-pointer list-none py-2.5 text-[15px] font-medium text-slate-900 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="mr-1 inline-block text-slate-400 transition-transform group-open:rotate-90">›</span>
                {item.q}
              </summary>
              <p className="pb-2.5 pl-4 text-[14px] leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="mt-8 text-[13px] leading-relaxed text-slate-500">{copy.disclaimer}</p>
    </div>
  );
}
