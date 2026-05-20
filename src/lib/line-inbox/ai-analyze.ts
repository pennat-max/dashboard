import type { LineInboxAnalyzeItem, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

type AiAnalyzeItem = Partial<
  Pick<
    LineInboxAnalyzeItem,
    "raw_text" | "suggested_item_name" | "suggested_category" | "suggested_status" | "confidence" | "reason"
  >
>;

export type LineInboxAiAnalyzeDraft = {
  detected_car?: Partial<LineInboxAnalyzeResponse["detected_car"]>;
  detected_car_text?: string;
  candidate_cars?: Array<{ text?: string; confidence?: number; reason?: string }>;
  car_context?: string[];
  people_context?: string[];
  actual_work_items?: Array<string | AiAnalyzeItem>;
  notes?: string[];
  ignored_noise?: string[];
  items?: Array<string | AiAnalyzeItem>;
  ignored_vehicle_spec_lines?: string[];
  ignored_mention_lines?: string[];
  ignored_noise_lines?: string[];
  needs_human_review?: boolean;
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_GROQ_MODEL = "llama-3.1-70b-versatile";

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => safeString(v)).filter(Boolean).slice(0, 80);
}

function asContextArray(value: unknown): string[] {
  if (typeof value === "string") return safeString(value) ? [safeString(value)] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return safeString(item);
      if (!item || typeof item !== "object") return "";
      const obj = item as Record<string, unknown>;
      return (
        safeString(obj.text) ||
        safeString(obj.line) ||
        safeString(obj.raw_text) ||
        safeString(obj.name) ||
        safeString(obj.note) ||
        safeString(obj.label) ||
        safeString(obj.spec)
      );
    })
    .filter(Boolean)
    .slice(0, 80);
}

function asAiItems(value: unknown): Array<string | AiAnalyzeItem> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): string | AiAnalyzeItem | null => {
      if (typeof item === "string") return item.trim() || null;
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const name =
        safeString(obj.suggested_item_name) ||
        safeString(obj.item_name) ||
        safeString(obj.work_item) ||
        safeString(obj.text) ||
        safeString(obj.raw_text);
      if (!name) return null;
      return {
        raw_text: safeString(obj.raw_text) || safeString(obj.text) || name,
        suggested_item_name: name,
        suggested_category: safeString(obj.suggested_category),
        suggested_status: safeString(obj.suggested_status),
        confidence: typeof obj.confidence === "number" ? Number(obj.confidence) : undefined,
        reason: safeString(obj.reason),
      };
    })
    .filter(Boolean)
    .slice(0, 80) as Array<string | AiAnalyzeItem>;
}

function normalizeDraft(raw: unknown): LineInboxAiAnalyzeDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const detectedRaw = input.detected_car;
  const detected_car =
    detectedRaw && typeof detectedRaw === "object"
      ? {
          plate_text: safeString((detectedRaw as Record<string, unknown>).plate_text),
          chassis: safeString((detectedRaw as Record<string, unknown>).chassis),
          car_row_id: safeString((detectedRaw as Record<string, unknown>).car_row_id),
          spec_text: safeString((detectedRaw as Record<string, unknown>).spec_text),
          sale: safeString((detectedRaw as Record<string, unknown>).sale),
          confidence:
            typeof (detectedRaw as Record<string, unknown>).confidence === "number"
              ? Number((detectedRaw as Record<string, unknown>).confidence)
              : undefined,
        }
      : undefined;

  const actual_work_items = asAiItems(input.actual_work_items);
  const legacyItems = asAiItems(input.items);
  const items = actual_work_items.length ? actual_work_items : legacyItems;
  const car_context = asContextArray(input.car_context);
  const people_context = asContextArray(input.people_context);
  const notes = asContextArray(input.notes);
  const ignored_noise = asContextArray(input.ignored_noise);

  return {
    detected_car,
    detected_car_text: safeString(input.detected_car_text),
    candidate_cars: Array.isArray(input.candidate_cars)
      ? input.candidate_cars
          .map((item) => {
            if (typeof item === "string") return { text: item };
            if (!item || typeof item !== "object") return null;
            const obj = item as Record<string, unknown>;
            const text = safeString(obj.text) || safeString(obj.spec) || safeString(obj.label);
            if (!text) return null;
            return {
              text,
              confidence: typeof obj.confidence === "number" ? Number(obj.confidence) : undefined,
              reason: safeString(obj.reason),
            };
          })
          .filter(Boolean)
          .slice(0, 10) as Array<{ text?: string; confidence?: number; reason?: string }>
      : [],
    car_context,
    people_context,
    actual_work_items,
    notes,
    ignored_noise,
    items,
    ignored_vehicle_spec_lines: [...car_context, ...asStringArray(input.ignored_vehicle_spec_lines)].slice(0, 80),
    ignored_mention_lines: [...people_context, ...asStringArray(input.ignored_mention_lines)].slice(0, 80),
    ignored_noise_lines: [...notes, ...ignored_noise, ...asStringArray(input.ignored_noise_lines)].slice(0, 80),
    needs_human_review: typeof input.needs_human_review === "boolean" ? input.needs_human_review : undefined,
  };
}

function extractJsonObject(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }
    throw new Error("AI response JSON invalid");
  }
}

function buildPrompt(rawText: string): string {
  return [
    "You are a VIGO4U LINE Inbox parser for a used-car operations dashboard.",
    "Return strict JSON only. Do not include markdown.",
    "",
    "First read the entire LINE message as one conversation chunk. Use all surrounding lines before deciding whether any phrase is car context, people context, an actual work item, note, or noise.",
    "",
    "Then separate the whole message into:",
    "1. detected_car",
    "2. car_context",
    "3. people_context",
    "4. actual_work_items",
    "5. notes",
    "6. ignored_noise",
    "7. ignored_mention_lines",
    "8. ignored_vehicle_spec_lines",
    "9. ignored_noise_lines",
    "10. needs_human_review",
    "",
    "Rules:",
    "- AI only suggests. It never saves anything.",
    "- car_context: plate, chassis, stock number, car spec, brand/model/color/year, or car lookup clues. Never save these as order items.",
    "- people_context: mentions, tags, names, sale/staff/person clues, assignee clues, emoji/person chat context. Never save these as order items.",
    "- actual_work_items: only actionable work/request lines.",
    "- notes: extra instructions or ambiguous context that is not a saveable work item.",
    "- ignored_noise: emoji-only, punctuation-only, greeting, chat decoration, or unrelated text.",
    "- Mentions/tags such as @JOY, @MINT, @Aof are people_context only, not order items.",
    "- If a line is only people, roles, tags, emoji, chat decoration, or punctuation, put it in people_context or ignored_noise, not actual_work_items.",
    "- Example non-work person/context line: LoSo 🚙🚗 Aekkarach TH ... กวาง.",
    "- Vehicle spec/model/plate/chassis-only lines are car_context only, not order items.",
    "- Stock/spec/model lines are context only, not order items. Example: 03306 Nissan navara D-cab 2.3 DC Pro4x 7AT 4WD Grey ป้ายแดง.",
    "- Put stock/spec/model lines in car_context and ignored_vehicle_spec_lines. If there may be multiple cars, put possible matches in candidate_cars and set needs_human_review=true.",
    "- Examples of vehicle spec: RANGER, REVO, HILUX, VIGO, NAVARA, NISSAN, 4WD, 2WD, 2.0, 2.3, 2.4, 2.8, AT, MT, Double Cab, D-cab, PRO4X, WHITE, GRAY/GREY, BLACK, red plate, year.",
    "- If a line has mentions plus real work, use mentions as people_context/assignee clue only. Example: '@PREW เช็คกันสาด' -> actual_work_items item_name='เช็คกันสาด'.",
    "- If a line has plate/chassis plus real work, remove plate/chassis from the item name.",
    "- Work items must include action intent such as เปลี่ยน, สั่ง, เช็ค, ซ่อม, ติด, ติดตั้ง, ส่งอู่, เพิ่ม, รับแล้ว, ของมาแล้ว, order, check, repair, install.",
    "- Do not create order items from people_context, car_context, notes, or ignored_noise.",
    "- Set needs_human_review=true if car match is unclear, items are ambiguous, confidence is low, or you are unsure.",
    "",
    "JSON schema:",
    JSON.stringify({
      detected_car: { plate_text: "", chassis: "", car_row_id: "", spec_text: "", sale: "", confidence: 0 },
      candidate_cars: [{ text: "", confidence: 0, reason: "" }],
      car_context: [""],
      people_context: [""],
      actual_work_items: [
        {
          raw_text: "",
          suggested_item_name: "",
          suggested_category: "",
          suggested_status: "",
          confidence: 0,
          reason: "",
        },
      ],
      notes: [""],
      ignored_noise: [""],
      ignored_mention_lines: [""],
      ignored_vehicle_spec_lines: [""],
      ignored_noise_lines: [""],
      needs_human_review: true,
    }),
    "",
    "LINE message:",
    rawText,
  ].join("\n");
}

async function callGemini(prompt: string): Promise<LineInboxAiAnalyzeDraft | null> {
  const apiKey = safeString(process.env.GEMINI_API_KEY);
  if (!apiKey) return null;
  const model = safeString(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini analyze failed: ${res.status}`);
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n").trim() ?? "";
  if (!text) throw new Error("Gemini analyze returned empty text");
  return normalizeDraft(extractJsonObject(text));
}

async function callGroq(prompt: string): Promise<LineInboxAiAnalyzeDraft | null> {
  const apiKey = safeString(process.env.GROQ_API_KEY);
  if (!apiKey) return null;
  const model = safeString(process.env.GROQ_MODEL) || DEFAULT_GROQ_MODEL;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return strict JSON only for LINE Inbox parsing. Never include markdown.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq analyze failed: ${res.status}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Groq analyze returned empty text");
  return normalizeDraft(extractJsonObject(text));
}

export async function runLineInboxAiAnalyze(rawText: string): Promise<LineInboxAiAnalyzeDraft | null> {
  const prompt = buildPrompt(rawText);
  if (safeString(process.env.GEMINI_API_KEY)) {
    return callGemini(prompt);
  }
  if (safeString(process.env.GROQ_API_KEY)) {
    return callGroq(prompt);
  }
  return null;
}
