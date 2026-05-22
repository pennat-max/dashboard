"use client";

import { cn } from "@/lib/utils";

type Lang = "th" | "en";

function normalizeLine(s: string): string {
  return String(s ?? "").trim();
}

export function LineInboxTaskLinesCompare({
  lang,
  ruleLines,
  usedLines,
  usedSource,
  aiGroqLines,
  aiGeminiLines,
  chosenAiProvider,
  className,
}: {
  lang: Lang;
  ruleLines: string[];
  usedLines: string[];
  usedSource?: "heuristic" | "llm";
  /** เมื่อเซิร์ฟเวอร์ส่ง `task_lines_ai_by_model` แสดง Groq และ Gemini เทียบกัน */
  aiGroqLines?: string[] | null;
  aiGeminiLines?: string[] | null;
  chosenAiProvider?: "groq" | "gemini" | null;
  className?: string;
}) {
  if (ruleLines.length === 0 && usedLines.length === 0) return null;

  const identical =
    ruleLines.length === usedLines.length &&
    ruleLines.every((a, i) => normalizeLine(a) === normalizeLine(usedLines[i] ?? ""));

  const n = Math.max(ruleLines.length, usedLines.length, 1);

  const leftCaption = lang === "en" ? "Rule-only split" : "แบบ rule เดิม";
  const rightCaption =
    usedSource === "llm"
      ? lang === "en"
        ? "Result (AI)"
        : "ผลที่ใช้ (AI)"
      : lang === "en"
        ? "Result used"
        : "ผลที่ใช้";

  return (
    <details
      className={cn(
        "min-w-[8.5rem] flex-1 rounded-xl border border-violet-200/90 bg-violet-50/50 text-left ring-1 ring-violet-100",
        className
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-1 px-2.5 py-2 text-[11px] font-semibold text-violet-950 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 leading-snug">
          {lang === "en" ? "Compare splits" : "เปรียบเทียบการแยกบรรทัด"}
          {identical ? (
            <span className="mt-0.5 block font-normal text-emerald-800">
              {lang === "en" ? "(same as rule)" : "(เหมือน rule เดิม)"}
            </span>
          ) : usedSource === "llm" ? (
            <span className="mt-0.5 block font-normal text-amber-900">
              {lang === "en" ? "(AI differs from rule)" : "(AI ต่างจาก rule เดิม)"}
            </span>
          ) : ruleLines.length > 0 && usedLines.length > 0 && !identical ? (
            <span className="mt-0.5 block font-normal text-slate-600">
              {lang === "en" ? "(see both columns)" : "(ดูสองคอลัมน์)"}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 opacity-95">
          {lang === "en" ? "tap ▼" : "แตะ ▼"}
        </span>
      </summary>
      <div className="border-t border-violet-100 px-2 pb-2 pt-1">
        <div className="grid max-h-[min(40vh,220px)] grid-cols-2 gap-2 overflow-y-auto overscroll-contain text-[10px] leading-snug">
          <div>
            <p className="mb-1 font-bold text-slate-700">{leftCaption}</p>
            <ol className="list-decimal space-y-1 pl-4 text-slate-800">
              {Array.from({ length: n }, (_, i) => {
                const t = ruleLines[i];
                return (
                  <li
                    key={`r-${i}`}
                    className={cn(
                      "break-words",
                      t == null || !String(t).trim() ? "text-slate-400" : ""
                    )}
                  >
                    {t != null && String(t).trim() ? t : "—"}
                  </li>
                );
              })}
            </ol>
          </div>
          <div>
            <p className="mb-1 font-bold text-slate-700">{rightCaption}</p>
            <ol className="list-decimal space-y-1 pl-4 text-slate-800">
              {Array.from({ length: n }, (_, i) => {
                const t = usedLines[i];
                const r = ruleLines[i];
                const rowDiff =
                  r != null &&
                  t != null &&
                  String(r).trim() &&
                  String(t).trim() &&
                  normalizeLine(String(r)) !== normalizeLine(String(t));
                return (
                  <li
                    key={`u-${i}`}
                    className={cn(
                      "break-words",
                      t == null || !String(t).trim() ? "text-slate-400" : "",
                      rowDiff ? "rounded bg-amber-50/90 px-0.5 text-amber-950 ring-1 ring-amber-200/80" : ""
                    )}
                  >
                    {t != null && String(t).trim() ? t : "—"}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {aiGroqLines != null && aiGeminiLines != null ? (
          <div className="mt-3 border-t border-indigo-100 pt-2">
            <p className="mb-1.5 text-[10px] font-bold text-indigo-900">
              {lang === "en" ? "Groq vs Gemini (raw)" : "ผลจาก Groq กับ Gemini (แต่ละรุ่น)"}
            </p>
            <div className="grid max-h-[min(35vh,200px)] grid-cols-2 gap-2 overflow-y-auto overscroll-contain text-[10px] leading-snug">
              <div>
                <p className="mb-1 flex flex-wrap items-center gap-1 font-bold text-slate-700">
                  Groq
                  {chosenAiProvider === "groq" ? (
                    <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-900 ring-1 ring-emerald-200">
                      {lang === "en" ? "used" : "ใช้ผลนี้"}
                    </span>
                  ) : null}
                </p>
                <ol className="list-decimal space-y-1 pl-4 text-slate-800">
                  {aiGroqLines.length === 0 ? (
                    <li className="text-slate-400">{lang === "en" ? "(no lines)" : "(ไม่มีบรรทัด)"}</li>
                  ) : (
                    aiGroqLines.map((t, i) => (
                      <li key={`gq-${i}`} className="break-words">
                        {String(t).trim() ? t : "—"}
                      </li>
                    ))
                  )}
                </ol>
              </div>
              <div>
                <p className="mb-1 flex flex-wrap items-center gap-1 font-bold text-slate-700">
                  Gemini
                  {chosenAiProvider === "gemini" ? (
                    <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-900 ring-1 ring-emerald-200">
                      {lang === "en" ? "used" : "ใช้ผลนี้"}
                    </span>
                  ) : null}
                </p>
                <ol className="list-decimal space-y-1 pl-4 text-slate-800">
                  {aiGeminiLines.length === 0 ? (
                    <li className="text-slate-400">{lang === "en" ? "(no lines)" : "(ไม่มีบรรทัด)"}</li>
                  ) : (
                    aiGeminiLines.map((t, i) => (
                      <li key={`gm-${i}`} className="break-words">
                        {String(t).trim() ? t : "—"}
                      </li>
                    ))
                  )}
                </ol>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
