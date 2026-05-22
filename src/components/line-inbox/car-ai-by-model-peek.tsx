"use client";

import type { LineInboxCarAiByModel, LineInboxCarAiModelPick } from "@/lib/line-inbox/types";
import { cn } from "@/lib/utils";

type Lang = "th" | "en";

function CarPickCard({
  label,
  lang,
  pick,
  matchesFinal,
}: {
  label: string;
  lang: Lang;
  pick: LineInboxCarAiModelPick;
  matchesFinal: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white/90 px-2 py-1.5 ring-1 ring-slate-100",
        matchesFinal ? "border-emerald-200 ring-emerald-100" : "border-slate-200"
      )}
    >
      <p className="mb-0.5 flex flex-wrap items-center gap-1 text-[10px] font-bold text-slate-800">
        {label}
        {matchesFinal ? (
          <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-900 ring-1 ring-emerald-200">
            {lang === "en" ? "matches result" : "ตรงกับผลที่ใช้"}
          </span>
        ) : pick ? (
          <span className="font-normal text-slate-400">
            {lang === "en" ? "(other pick)" : "(คนละคันกับผลที่ใช้)"}
          </span>
        ) : null}
      </p>
      {!pick ? (
        <p className="text-[10px] text-slate-400">{lang === "en" ? "No confident pick" : "ไม่เลือกคันได้ชัดเจน"}</p>
      ) : (
        <ul className="space-y-0.5 text-[10px] leading-snug text-slate-800">
          <li>
            <span className="text-slate-500">{lang === "en" ? "Plate" : "ทะเบียน"}:</span>{" "}
            <span className="font-semibold tabular-nums">{pick.plate_text?.trim() || "—"}</span>
          </li>
          {pick.spec?.trim() ? (
            <li className="break-words text-slate-700">
              <span className="text-slate-500">{lang === "en" ? "Spec (display)" : "สเปก (แสดง)"}:</span>{" "}
              {pick.spec.trim()}
            </li>
          ) : null}
          {pick.line_spec_snippet?.trim() ? (
            <li className="break-words text-emerald-900/90">
              <span className="text-slate-500">{lang === "en" ? "Line spec (match)" : "สเปกข้อความ (เทียบ)"}:</span>{" "}
              {pick.line_spec_snippet.trim()}
            </li>
          ) : null}
          {pick.db_spec?.trim() ? (
            <li className="break-words text-slate-600">
              <span className="text-slate-500">{lang === "en" ? "DB spec" : "สเปก DB"}:</span>{" "}
              {pick.db_spec.trim()}
            </li>
          ) : null}
          {pick.chassis?.trim() ? (
            <li className="break-all font-mono text-[9px] text-slate-600">
              VIN/Chassis · {pick.chassis.trim()}
            </li>
          ) : null}
          <li className="truncate font-mono text-[9px] text-slate-500">{pick.car_row_id}</li>
          <li className="tabular-nums text-slate-600">
            confidence · {Math.round((pick.confidence ?? 0) * 100)}%
          </li>
        </ul>
      )}
    </div>
  );
}

export function LineInboxCarAiByModelPeek({
  lang,
  aiByModel,
  finalCarRowId,
  className,
}: {
  lang: Lang;
  aiByModel: LineInboxCarAiByModel;
  finalCarRowId: string;
  className?: string;
}) {
  const fid = String(finalCarRowId ?? "").trim();

  const gMatch = fid && aiByModel.groq?.car_row_id?.trim() === fid;
  const mMatch = fid && aiByModel.gemini?.car_row_id?.trim() === fid;

  return (
    <details
      className={cn(
        "rounded-xl border border-emerald-200/80 bg-emerald-50/40 text-left ring-1 ring-emerald-100",
        className
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-1 px-2.5 py-2 text-[11px] font-semibold text-emerald-950 [&::-webkit-details-marker]:hidden">
        <span>
          {lang === "en"
            ? "Groq vs Gemini — car picks"
            : "Groq และ Gemini เลือกคันอย่างไร"}
        </span>
        <span className="shrink-0 rounded bg-emerald-100/90 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
          {lang === "en" ? "tap ▼" : "แตะ ▼"}
        </span>
      </summary>
      <div className="border-t border-emerald-100 px-2 pb-2 pt-2">
        <p className="mb-2 text-[9px] leading-snug text-emerald-900/90">
          {lang === "en"
            ? "Final car shown above is picked by routing order — compare both providers here."
            : "ผลรถด้านบนมาจากลำดับใน env เทียบกับว่าแต่ละโมเดลชี้ไปที่คันใดที่นี่"}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CarPickCard lang={lang} label="Groq" pick={aiByModel.groq} matchesFinal={Boolean(gMatch)} />
          <CarPickCard lang={lang} label="Gemini" pick={aiByModel.gemini} matchesFinal={Boolean(mMatch)} />
        </div>
      </div>
    </details>
  );
}
