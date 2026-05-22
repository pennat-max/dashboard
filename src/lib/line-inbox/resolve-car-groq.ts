import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedCar } from "@/lib/line-inbox/resolve-car";
import {
  buildCarLlmUserPayload,
  CAR_LLM_SYSTEM_PROMPT_TH,
  expandLineInboxLlmCandidates,
  fetchLeanCarsForLlmCandidates,
  hydrateCarPickFromRowId,
  parseCarLlmPickJson,
} from "@/lib/line-inbox/resolve-car-llm-shared";

function groqModel(): string {
  const m = String(process.env.GROQ_MODEL ?? "").trim();
  /** ค่าเริ่มต้นเดียวกับ task-lines / ai-split — llama-3.3 บางบัญชีอาจได้ empty หรือ wrap JSON แปลก */
  return m || "llama-3.1-70b-versatile";
}

/**
 * Groq (OpenAI-compatible) เลือกรถจาก candidates เท่านั้น — คู่กับ Gemini ใน LINE inbox
 */
export async function pickCarWithGroq(
  supabase: SupabaseClient,
  rawText: string,
  apiKey: string,
  heuristicGuess: ResolvedCar
): Promise<ResolvedCar | null> {
  const raw = String(rawText ?? "").trim();
  if (!raw) return null;

  const inventory = await fetchLeanCarsForLlmCandidates(supabase);
  if (!inventory.length) return null;

  const candidates = expandLineInboxLlmCandidates(inventory, raw);
  if (!candidates.length) return null;

  const allowed = new Set(
    candidates
      .map((c) => String(c.row_id ?? "").trim())
      .filter(Boolean)
  );
  if (!allowed.size) return null;

  const userContent = JSON.stringify(buildCarLlmUserPayload(raw, heuristicGuess, candidates), null, 0);

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: groqModel(),
      temperature: 0.12,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CAR_LLM_SYSTEM_PROMPT_TH },
        { role: "user", content: userContent },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!res.ok) {
    throw new Error(json.error?.message ?? res.statusText);
  }

  const content = String(json.choices?.[0]?.message?.content ?? "").trim();
  const parsedAi = parseCarLlmPickJson(content);
  if (!parsedAi?.chosen_car_row_id) return null;

  return hydrateCarPickFromRowId(supabase, parsedAi.chosen_car_row_id, allowed, parsedAi.match_confidence);
}
