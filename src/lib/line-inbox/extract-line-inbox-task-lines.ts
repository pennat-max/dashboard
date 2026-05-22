/**
 * LINE inbox: ถอดข้อความเป็นบรรทัดงาน — heuristic จาก split-line-text ก่อน
 * ถ้าไม่พอให้ Gemini / Groq แตกเป็น lines (เหมือนแนว order-intake ai-split)
 */

import { LINE_INBOX_IMAGE_PLACEHOLDER } from "@/lib/line-inbox/line-image-placeholder";
import { filterLlmExtractedTaskLines, splitLineTextToTaskLines } from "@/lib/line-inbox/split-line-text";

function sanitizeOneLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function dedupeTaskLines(lines: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of lines) {
    const s = sanitizeOneLine(String(x ?? ""));
    if (s.length < 2) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 60) break;
  }
  return out;
}

/** ล้อม ```json ... ``` และลองดึงช่วง `{ ... }` สุดท้ายเมื่อ parse ทั้งก้อนล้ม */
function stripMarkdownJsonFences(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (/^```/i.test(s)) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  return s;
}

function parseTaskLinesJsonBlob(content: string, logLabel: string): string[] {
  const stripped = stripMarkdownJsonFences(content);
  if (!stripped) return [];

  const candidates: string[] = [stripped];
  const fb = stripped.indexOf("{");
  const lb = stripped.lastIndexOf("}");
  if (fb >= 0 && lb > fb) {
    candidates.push(stripped.slice(fb, lb + 1));
  }

  for (const blob of candidates) {
    try {
      const o = JSON.parse(blob) as Record<string, unknown>;
      const arr = o.lines ?? o.items ?? o.tasks;
      if (Array.isArray(arr)) return filterLlmExtractedTaskLines(dedupeTaskLines(arr));
    } catch {
      /* next candidate */
    }
  }

  console.warn(
    `[line-inbox] ${logLabel} task lines JSON parse failed; head:`,
    stripped.slice(0, 280)
  );
  return [];
}

/** โมเดลเดียวกับ order-intake ai-split — บางโมเดล/รุ่นคืน Markdown รอบ JSON ทำให้ parse ว่าง */
const GROQ_TASK_LINES_DEFAULT_MODEL = "llama-3.1-70b-versatile";

function taskLinesLlmDisabled(): boolean {
  return String(process.env.LINE_INBOX_USE_LLM_FOR_TASK_LINES ?? "").trim().toLowerCase() === "false";
}

function taskLinesLlmOrderRaw(): string {
  return String(process.env.LINE_INBOX_TASK_LINES_LLM_ORDER ?? "").trim().toLowerCase();
}

function taskLinesGroqOnly(): boolean {
  return taskLinesLlmOrderRaw() === "groq_only";
}

function taskLinesGeminiOnly(): boolean {
  return taskLinesLlmOrderRaw() === "gemini_only";
}

/** เริ่ม Gemini หรือ Groq — ถ้าไม่ตั้ง ใช้ groq_first (โมเดลเร็ว) */
function taskLinesGroqFirst(): boolean {
  const raw = taskLinesLlmOrderRaw();
  if (raw === "gemini_first" || raw === "gemini,groq") return false;
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * ค่าเริ่มต้น: พยายามใช้ LLM ทุกครั้งเมื่อมี API key เพื่อแยกรายการให้ได้
 * ประหยัดค่าเรียกด้วย LINE_INBOX_TASK_LINES_LLM_ONLY_WHEN_NEEDED=true (แบบเก่าที่เรียกเฉพาะ heuristic ว่าง / ประโยคยาว)
 */
function taskLinesAlwaysTryLlm(): boolean {
  return String(process.env.LINE_INBOX_TASK_LINES_LLM_ONLY_WHEN_NEEDED ?? "").trim().toLowerCase() !== "true";
}

/**
 * heuristic ว่าง / ได้ก้อนยาวเดียว / body ใหญ่เกินจากที่ rule ครอบ
 */
export function needsLlmTaskLineExtraction(heuristicLines: string[], raw: string): boolean {
  const t = raw.trim();
  if (!t || t === LINE_INBOX_IMAGE_PLACEHOLDER) return false;
  if (t.length < 55) return false;

  const bodyLines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;

  if (heuristicLines.length === 0 && (t.length >= 70 || bodyLines >= 2)) return true;

  const one = heuristicLines.length === 1 ? heuristicLines[0] ?? "" : "";
  if (heuristicLines.length === 1 && one.length >= 180) return true;

  /** ได้บางบรรทัดแต่ข้อความหลายย่อหน้าเหลืออยู่อีกพอควรให้ถอด */
  if (heuristicLines.length >= 1 && heuristicLines.length < bodyLines - 1 && t.length >= 280) return true;

  return false;
}

async function groqExtractTaskLines(raw: string, existing: string[]): Promise<string[]> {
  const key = String(process.env.GROQ_API_KEY ?? "").trim();
  if (!key || taskLinesGeminiOnly()) return [];

  const model = String(process.env.GROQ_MODEL ?? "").trim() || GROQ_TASK_LINES_DEFAULT_MODEL;
  const sys =
    'You extract discrete workshop TASK lines from Thai LINE paste about car jobs. Return ONLY JSON {"lines":["..."]}.\n' +
    "Rules:\n" +
    "- Each array element = ONE actionable workshop job in Thai (short; e.g. install, replace, check).\n" +
    "- NEVER put in `lines`: Thai license plates, vehicle spec header lines (model/trim/engine/trans/color/month), chassis/VIN lines, or pure non-task English header text.\n" +
    "- Drop lines that are only @mentions or only a phone number.\n" +
    "- Split long prose with several jobs ( และ / พร้อม / ให้ ) into multiple lines.\n" +
    "- Do NOT invent jobs not clearly implied by the user's text.";
  const user =
    `TEXT:\n${raw.slice(0, 12000)}\n\nEXISTING_ORDER_ITEMS (hint for wording, OK to omit):\n${existing.slice(0, 80).join("\n").slice(0, 6000)}\nReturn JSON lines only.`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.12,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{
      message?: { content?: string | null; refusal?: string | null };
      finish_reason?: string;
    }>;
  };
  if (!res.ok) {
    console.error("[line-inbox] Groq task lines:", json.error?.message ?? res.statusText);
    return [];
  }

  const choice = json.choices?.[0];
  const msg = choice?.message as { content?: string | null; refusal?: string | null } | undefined;
  if (msg?.refusal) {
    console.warn("[line-inbox] Groq task lines: model refusal:", msg.refusal);
    return [];
  }

  const content = String(msg?.content ?? "").trim();
  if (!content) {
    console.warn(
      "[line-inbox] Groq task lines: empty message content",
      JSON.stringify({ finish_reason: choice?.finish_reason, model })
    );
    return [];
  }

  return parseTaskLinesJsonBlob(content, "Groq");
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function resolveGeminiModelId(rawEnv: string): string {
  const m = rawEnv.trim();
  if (!m) return DEFAULT_GEMINI_MODEL;
  const key = m.toLowerCase();
  const aliases: Record<string, string> = {
    "gemini-1.5-flash": DEFAULT_GEMINI_MODEL,
    "gemini-pro": DEFAULT_GEMINI_MODEL,
  };
  return aliases[key] ?? m;
}

function geminiGenerateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.trim())}:generateContent`;
}

async function geminiExtractTaskLines(raw: string, existing: string[]): Promise<string[]> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey || taskLinesGroqOnly()) return [];

  const modelId = resolveGeminiModelId(process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
  const sys =
    'แยกรายการงานซ่อม/แต่งรถจากข้อความ LINE เป็น JSON เดียว: {"lines":["..."]}. ' +
    "แต่ละข้อความใน lines = หนึ่งงานที่อู่ทำจริง ภาษาไทยสั้น (เช่น ติดพวงมาลัย เปลี่ยนยาง). " +
    "ห้ามใส่ใน lines เด็ดขาด: ป้ายทะเบียนไทย, บรรทัดสเปค/รุ่นรถ/สี/เครื่อง/เกียร์ทั้งแถว, เลขตัวถังหรือ VIN, หรือบรรทัดที่เป็นหัวข้อรถอย่างเดียว. " +
    "ตัดบรรทัดมีแค่ @mention หรือแค่เบอร์โทร. " +
    "ประโยคยาวที่มีหลายงาน ให้แตกเป็นหลายบรรทัด. " +
    "ห้ามเพิ่มงานที่ข้อความผู้ใช้ไม่ได้กล่าวถึง (ห้ามเดาหรือเติมจากแม่แบบ).";

  const user =
    `${raw.slice(0, 12000)}\n\nรายการเดิมในระบบ (อ้างอิงเท่านั้น):\n${existing.slice(0, 80).join("\n").slice(0, 4000)}`;

  const url = `${geminiGenerateUrl(modelId)}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.12,
        responseMimeType: "application/json",
      },
    }),
  });

  const rawJson = (await res.json()) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!res.ok) {
    console.error("[line-inbox] Gemini task lines:", rawJson.error?.message ?? res.statusText);
    return [];
  }

  const parts = rawJson.candidates?.[0]?.content?.parts;
  const chunk = Array.isArray(parts) ? parts.map((p) => String(p.text ?? "")).join("") : "";
  if (!chunk.trim()) return [];
  return parseTaskLinesJsonBlob(chunk, "Gemini");
}

export type LineInboxTaskLineSource = "heuristic" | "llm";

function choosePreferredTaskLinesByOrder(
  dual: { groq: string[]; gemini: string[] },
  preferGroq: boolean
): { lines: string[]; chosen: "groq" | "gemini" | null } {
  const gOk = dual.groq.length > 0 ? dual.groq : null;
  const mOk = dual.gemini.length > 0 ? dual.gemini : null;
  if (preferGroq) {
    if (gOk) return { lines: gOk, chosen: "groq" };
    if (mOk) return { lines: mOk, chosen: "gemini" };
    return { lines: [], chosen: null };
  }
  if (mOk) return { lines: mOk, chosen: "gemini" };
  if (gOk) return { lines: gOk, chosen: "groq" };
  return { lines: [], chosen: null };
}

/** เรียก Groq + Gemini พร้อมกัน และลองใหม่สลับลำดับการเลือก — คืนทั้งบรรทัดที่ใช้จริงและผลแยกรุ่น */
async function runLlmTaskExtractBothModels(
  raw: string,
  existingLabels: string[]
): Promise<{
  lines: string[];
  chosen: "groq" | "gemini" | null;
  byModel: { groq: string[]; gemini: string[] };
}> {
  const primaryGroqFirst = taskLinesGroqFirst();
  let lastDual = { groq: [] as string[], gemini: [] as string[] };
  let lastChosen: "groq" | "gemini" | null = null;
  let lastLines: string[] = [];

  const maxPasses = 3;
  for (let pass = 0; pass < maxPasses; pass++) {
    const preferGroq = pass % 2 === 0 ? primaryGroqFirst : !primaryGroqFirst;
    const [groqLines, geminiLines] = await Promise.all([
      groqExtractTaskLines(raw, existingLabels),
      geminiExtractTaskLines(raw, existingLabels),
    ]);
    lastDual = { groq: groqLines, gemini: geminiLines };
    const sel = choosePreferredTaskLinesByOrder(lastDual, preferGroq);
    lastLines = sel.lines;
    lastChosen = sel.chosen;
    if (lastLines.length > 0) break;
    if (pass < maxPasses - 1) await delay(320 + pass * 180);
  }

  return { lines: lastLines, chosen: lastChosen, byModel: lastDual };
}

export async function extractLineInboxTaskLines(
  raw: string,
  existingLabels: string[]
): Promise<{
  lines: string[];
  lines_source: LineInboxTaskLineSource;
  lines_heuristic: string[];
  lines_ai_by_model?: { groq: string[]; gemini: string[] };
  lines_llm_pick?: "groq" | "gemini" | null;
}> {
  if (!raw.trim() || raw.trim() === LINE_INBOX_IMAGE_PLACEHOLDER) {
    return { lines: [], lines_source: "heuristic", lines_heuristic: [] };
  }

  const heuristic = splitLineTextToTaskLines(raw);

  if (taskLinesLlmDisabled()) {
    return { lines: heuristic, lines_source: "heuristic", lines_heuristic: heuristic };
  }

  const geminiKey = Boolean(String(process.env.GEMINI_API_KEY ?? "").trim());
  const groqKey = Boolean(String(process.env.GROQ_API_KEY ?? "").trim());

  const wantLlm =
    (geminiKey || groqKey) &&
    (taskLinesAlwaysTryLlm() || needsLlmTaskLineExtraction(heuristic, raw));

  let ai: string[] = [];
  let dualAi: { groq: string[]; gemini: string[] } | undefined;
  let pick: "groq" | "gemini" | null | undefined;

  if (wantLlm) {
    try {
      const bundle = await runLlmTaskExtractBothModels(raw, existingLabels);
      ai = bundle.lines;
      dualAi = bundle.byModel;
      pick = bundle.chosen;
    } catch (e) {
      console.error("[line-inbox] Task lines LLM:", e instanceof Error ? e.message : e);
      ai = [];
      dualAi = { groq: [], gemini: [] };
      pick = null;
    }
    const baseExtras = dualAi ? { lines_ai_by_model: dualAi, lines_llm_pick: pick ?? null } : {};
    if (ai.length > 0) {
      return {
        lines: ai,
        lines_source: "llm",
        lines_heuristic: heuristic,
        ...baseExtras,
      };
    }
    return {
      lines: heuristic,
      lines_source: "heuristic",
      lines_heuristic: heuristic,
      ...baseExtras,
    };
  }

  return { lines: heuristic, lines_source: "heuristic", lines_heuristic: heuristic };
}
