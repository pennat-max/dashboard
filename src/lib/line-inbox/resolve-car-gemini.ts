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

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function resolveGeminiModelId(raw: string): string {
  const m = raw.trim();
  if (!m) return DEFAULT_GEMINI_MODEL;
  const key = m.toLowerCase();
  const aliases: Record<string, string> = {
    "gemini-1.5-flash": DEFAULT_GEMINI_MODEL,
    "gemini-1.5-flash-latest": DEFAULT_GEMINI_MODEL,
    "gemini-1.5-pro": DEFAULT_GEMINI_MODEL,
    "gemini-1.5-pro-latest": DEFAULT_GEMINI_MODEL,
    "gemini-pro": DEFAULT_GEMINI_MODEL,
  };
  return aliases[key] ?? m;
}

function geminiGenerateUrl(model: string): string {
  const m = encodeURIComponent(model.trim());
  return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableGeminiOverload(status: number, message: string): boolean {
  const m = message.toLowerCase();
  if (status === 429 || status === 503) return true;
  if (m.includes("high demand")) return true;
  if (m.includes("resource exhausted")) return true;
  if (m.includes("overloaded")) return true;
  if (m.includes("try again later")) return true;
  if (m.includes("too many requests")) return true;
  return false;
}

function uniqueModelOrder(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models) {
    const id = resolveGeminiModelId(raw.trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function geminiFallbackModelList(primary: string): string[] {
  const fromEnv = (process.env.GEMINI_FALLBACK_MODELS ?? "").trim();
  if (fromEnv) {
    return uniqueModelOrder([primary, ...fromEnv.split(/[,\s]+/).filter(Boolean)]);
  }
  return uniqueModelOrder([primary, "gemini-2.0-flash", "gemini-2.5-flash"]);
}

/**
 * Gemini เลือกรถจาก candidates เท่านั้น — ใช้หลัง heuristic ใน LINE inbox analyze
 */
export async function pickCarWithGemini(
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

  const userObj = buildCarLlmUserPayload(raw, heuristicGuess, candidates);

  const primaryModel = resolveGeminiModelId(process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
  const modelCandidates = geminiFallbackModelList(primaryModel);
  const body = {
    systemInstruction: { parts: [{ text: CAR_LLM_SYSTEM_PROMPT_TH }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(userObj, null, 0) }] }],
    generationConfig: {
      temperature: 0.12,
      responseMimeType: "application/json" as const,
    },
  };

  let text = "";
  outer: for (const tryModel of modelCandidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await delay(350 * attempt + 150);
      const url = `${geminiGenerateUrl(tryModel)}?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const rawJson = (await res.json()) as {
        error?: { message?: string; status?: string };
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const msg = rawJson.error?.message ?? rawJson.error?.status ?? res.statusText;
      const parts = rawJson.candidates?.[0]?.content?.parts;
      const chunk = Array.isArray(parts) ? parts.map((p) => String(p.text ?? "")).join("") : "";

      if (res.ok && chunk.trim()) {
        text = chunk;
        break outer;
      }
      if (!isRetryableGeminiOverload(res.status, msg) || attempt >= 2) break;
    }
  }

  const parsedAi = parseCarLlmPickJson(text);
  if (!parsedAi?.chosen_car_row_id) return null;
  return hydrateCarPickFromRowId(
    supabase,
    parsedAi.chosen_car_row_id,
    allowed,
    parsedAi.match_confidence
  );
}
