import {
  ORDER_ITEM_PHOTO_REF_END,
  ORDER_ITEM_PHOTO_REF_START,
} from "@/lib/orders/order-item-tam-roop-token";

/** อ่าน env ตอนเรียกใช้ — กันกรณีโหลดโมดูลก่อนมี .env หรือรีสตาร์ทไม่จับค่าใหม่ */
function groqApiKey(): string {
  return String(process.env.GROQ_API_KEY ?? "").trim();
}
function geminiApiKey(): string {
  return String(process.env.GEMINI_API_KEY ?? "").trim();
}

/** มีคีย์เรียกโมเดลแปลบนเซิร์ฟเวอร์หรือไม่ — ใช้ใน API route */
export function translationApiKeysConfigured(): boolean {
  return Boolean(groqApiKey()) || Boolean(geminiApiKey());
}

function groqModel(): string {
  const m = String(process.env.GROQ_MODEL ?? "").trim();
  return m || "llama-3.3-70b-versatile";
}
function geminiModel(): string {
  const m = String(process.env.GEMINI_MODEL ?? "").trim();
  return m || "gemini-2.0-flash";
}

/** Unicode Thai block — กว้างกว่า `[ก-๙]` */
export function hasThaiScript(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** คีย์เดียวกับ buildItemNameEnglishMap (uniqueTrimmed -> cleanText) */
export function orderItemLabelEnglishMapKey(label: string): string {
  return cleanText(String(label ?? ""));
}

/** คีย์เดียวกับใน buildOrderItemNotesEnglishMap (uniqueTrimmed → cleanText) — ใช้ตอน lookup จากแถวที่ note มี \n */
export function orderItemNoteEnglishMapKey(note: string): string {
  return cleanText(String(note ?? ""));
}

/** เปรียบเทียบคำแปลกับต้นฉบับ — ไม่ใช้ toLowerCase() กับภาษาไทย (พฤติกรรม Unicode ทำให้คัดคำแปลที่ถูกต้องทิ้งได้) */
function normNoteCompare(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ");
}

/** คำอธิบายให้โมเดลห่อคำแปลของ 「ตามรูป/ตามภาพ」 — เก็บใน DB แล้ว UI ทำเป็นลิงก์ */
const PHOTO_REF_RULE_LABEL =
  'If the Thai contains "ตามรูป" or "ตามภาพ", translate that phrase with the shortest natural wording that fits. ' +
  `Wrap ONLY that English phrase between ${ORDER_ITEM_PHOTO_REF_START} and ${ORDER_ITEM_PHOTO_REF_END}. ` +
  "Example: Pads [[ref]]see photo[[/ref]]. One pair per occurrence.";

const PHOTO_REF_RULE_NOTE =
  'If the Thai contains "ตามรูป" or "ตามภาพ", use the shortest natural phrase (e.g. see photo, per photo). ' +
  `Wrap ONLY that English phrase between ${ORDER_ITEM_PHOTO_REF_START} and ${ORDER_ITEM_PHOTO_REF_END}. ` +
  "Do not wrap whole sentences. Preserve line breaks elsewhere.";

/** ใช้ในทุก prompt แปล — ให้ได้คำแปลสั้น พอดีมือถือ */
const TRANSLATE_STYLE_SHORT =
  "Prefer very short, terse English for a workshop/mobile UI: minimal words, no filler or polite fluff; keep numbers, codes, plates, and proper names unchanged.";

function sourceContainsTamRoopThai(src: string): boolean {
  return /(?:ตามรูป|ตามภาพ)/.test(src);
}

/** ชื่อรายการบรรทัดเดียว — ห่อคำที่เหลือเป็นภาษาไทยด้วย marker */
function harmonizeRefPicToken(value: string): string {
  const RS = ORDER_ITEM_PHOTO_REF_START;
  const RE = ORDER_ITEM_PHOTO_REF_END;
  return cleanText(
    String(value ?? "")
      .replace(/\((?:ตามรูป|ตามภาพ)\)/gi, ` (${RS}see photo${RE}) `)
      .replace(/(?:ตามรูป|ตามภาพ)/gi, `${RS}see photo${RE}`)
  );
}

/** หมายเหตุหลายบรรทัด — ไม่ยุบบรรทัดทั้งก้อน */
function harmonizeRefPicTokenPreserveBlocks(value: string): string {
  const RS = ORDER_ITEM_PHOTO_REF_START;
  const RE = ORDER_ITEM_PHOTO_REF_END;
  return String(value ?? "")
    .replace(/\((?:ตามรูป|ตามภาพ)\)/gi, ` (${RS}see photo${RE}) `)
    .replace(/(?:ตามรูป|ตามภาพ)/gi, `${RS}see photo${RE}`)
    .trim();
}

/** ถ้าโมเดลไม่ใส่ marker แต่ต้นฉบับมีตามรูป — พยายามห่อคำว่า see photo */
function ensureFallbackPhotoMarkers(en: string, src: string): string {
  if (!sourceContainsTamRoopThai(src)) return en;
  if (en.includes(ORDER_ITEM_PHOTO_REF_START)) return en;
  const RS = ORDER_ITEM_PHOTO_REF_START;
  const RE = ORDER_ITEM_PHOTO_REF_END;
  const once = en.replace(/\b(see the photo|see photo)\b/i, `${RS}$1${RE}`);
  return once !== en ? once : en;
}

function uniqueTrimmed(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const line = cleanText(raw);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function looksMostlyEnglish(text: string): boolean {
  if (!text) return false;
  if (hasThaiScript(text)) return false;
  const asciiChars = (text.match(/[A-Za-z]/g) ?? []).length;
  return asciiChars > 0;
}

/** ดึงค่าจาก object ที่โมเดลคืนมา — รองรับคีย์ไม่ตรงเป๊ะ / NFC */
function pickTranslationForSource(obj: Record<string, unknown>, src: string): string {
  if (Object.prototype.hasOwnProperty.call(obj, src)) {
    return String(obj[src] ?? "");
  }
  const sn = src.normalize("NFC");
  for (const [k, v] of Object.entries(obj)) {
    if (k.normalize("NFC") === sn) return String(v ?? "");
  }
  const lower = src.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return String(v ?? "");
  }
  return "";
}

/** แปลงรูปแบบ JSON หลายแบบจาก LLM เป็น map แหล่ง → ข้อความแปล */
function extractTranslationsRecord(parsed: unknown): Record<string, unknown> {
  if (parsed == null || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  const raw = root.translations;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const entry of raw) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const k = cleanText(String(entry[0] ?? ""));
        const v = entry[1];
        if (k) out[k] = v;
      } else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        const k = cleanText(
          String(o.source ?? o.from ?? o.th ?? o.thai ?? o.label ?? o.key ?? o.original ?? "")
        );
        const v = o.en ?? o.to ?? o.english ?? o.translation ?? o.value;
        if (k && v != null) out[k] = v;
      }
    }
    return out;
  }
  const meta = new Set(["labels", "notes", "note", "comment", "task", "error"]);
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) {
    if (meta.has(k.toLowerCase())) continue;
    if (typeof v === "string" || typeof v === "number") flat[k] = v;
  }
  return flat;
}

function mapSourcesToEnglish(obj: Record<string, unknown>, sources: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  /** โมเดลคืน map แต่คีย์ไม่ตรบกับไทย — ถ้าเหลือค่าเดียวที่เป็นข้อความ ใช้เป็นคำแปล */
  if (sources.length === 1) {
    const src = sources[0];
    const stringEntries = Object.entries(obj).filter(
      ([, v]) => typeof v === "string" || typeof v === "number"
    );
    if (stringEntries.length === 1) {
      const translated = harmonizeRefPicToken(String(stringEntries[0][1] ?? ""));
      if (translated && translated.toLowerCase() !== src.toLowerCase()) {
        return { [src]: translated };
      }
    }
  }
  for (const src of sources) {
    const raw = pickTranslationForSource(obj, src);
    const translated = harmonizeRefPicToken(raw);
    if (!translated) continue;
    if (translated.toLowerCase() === src.toLowerCase()) continue;
    out[src] = translated;
  }
  return out;
}

/** เมื่อ JSON batch ล้มเหลว — ขอคำแปลเป็นข้อความล้วน (ใช้หลักใน translateItemNameToEnglish) */
async function translatePlainGemini(label: string): Promise<string | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;
  const src = cleanText(label);
  if (!src || !hasThaiScript(src)) return null;

  const prompt =
    TRANSLATE_STYLE_SHORT +
    " Translate the following Thai automobile workshop task label into concise practical English. " +
    PHOTO_REF_RULE_LABEL +
    " Reply with ONLY the English translation, one line, no quotes or explanation.\n\n" +
    src;

  const modelCandidates = Array.from(
    new Set([
      geminiModel(),
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-1.5-flash",
    ])
  ).filter(Boolean);

  for (const model of modelCandidates) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const json = (await res.json()) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!res.ok) {
      console.warn("[item-name-translation] Gemini plain HTTP error:", model, json.error?.message ?? res.statusText);
      continue;
    }

    let text = String(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    text = text.replace(/^[\s"'「『]+/u, "").replace(/[\s"'」』]+$/u, "").trim();
    const cleaned = harmonizeRefPicToken(text.split(/\n/)[0] ?? "");
    if (cleaned && cleaned.toLowerCase() !== src.toLowerCase()) return cleaned;
  }
  return null;
}

async function translatePlainGroq(label: string): Promise<string | null> {
  const apiKey = groqApiKey();
  if (!apiKey) return null;
  const src = cleanText(label);
  if (!src || !hasThaiScript(src)) return null;

  const user =
    TRANSLATE_STYLE_SHORT +
    " Translate this Thai automobile workshop task label to concise English. " +
    PHOTO_REF_RULE_LABEL +
    " Reply with English text only, no quotes or explanation.\n\n" +
    src;

  const modelCandidates = Array.from(
    new Set([groqModel(), "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama-3.1-70b-versatile"])
  ).filter(Boolean);

  for (const model of modelCandidates) {
    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 160,
          messages: [{ role: "user", content: user }],
        }),
      });
    } catch (e) {
      console.warn("[item-name-translation] Groq plain fetch failed:", model, e);
      continue;
    }

    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!res.ok) {
      console.warn("[item-name-translation] Groq plain HTTP error:", model, json.error?.message ?? res.statusText);
      continue;
    }

    let text = String(json.choices?.[0]?.message?.content ?? "").trim();
    text = text.replace(/^[\s"'「『]+/u, "").replace(/[\s"'」』]+$/u, "").trim();
    const cleaned = harmonizeRefPicToken(text.split(/\n/)[0] ?? "");
    if (cleaned && cleaned.toLowerCase() !== src.toLowerCase()) return cleaned;
  }
  return null;
}

function parseJsonContent(content: string): unknown {
  let text = String(content ?? "").trim();
  if (!text) return null;
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "").trim();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function translateBatchWithGroq(labels: string[]): Promise<Record<string, string>> {
  const apiKey = groqApiKey();
  if (!apiKey) return {};
  const unique = uniqueTrimmed(labels);
  if (unique.length === 0) return {};

  const sys =
    TRANSLATE_STYLE_SHORT +
    " You translate Thai car-work item labels into concise practical English for workshop staff. " +
    PHOTO_REF_RULE_LABEL +
    " Return only JSON object with key 'translations' mapping each exact source label string to its English text. " +
    "Use the exact same keys as in the input labels array (same spelling and characters). " +
    "Do not add extra commentary.";
  const user =
    "Translate these labels into the shortest natural English. Keep model names, numbers, sizes, and codes unchanged. " +
    "If any label is already English, keep it as-is.\n\n" +
    JSON.stringify({ labels: unique }, null, 2);

  const modelCandidates = Array.from(
    new Set([groqModel(), "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "llama-3.1-70b-versatile"])
  ).filter(Boolean);

  for (const model of modelCandidates) {
    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
        }),
      });
    } catch (e) {
      console.warn("[item-name-translation] Groq fetch failed:", model, e);
      continue;
    }

    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!res.ok) {
      console.warn("[item-name-translation] Groq HTTP error:", model, json.error?.message ?? res.statusText);
      continue;
    }

    const content = String(json.choices?.[0]?.message?.content ?? "").trim();
    const parsed = parseJsonContent(content);
    if (parsed == null) continue;

    const obj = extractTranslationsRecord(parsed);
    const out = mapSourcesToEnglish(obj, unique);
    if (Object.keys(out).length > 0) return out;
  }

  return {};
}

async function translateBatchWithGemini(labels: string[]): Promise<Record<string, string>> {
  const apiKey = geminiApiKey();
  if (!apiKey) return {};
  const unique = uniqueTrimmed(labels);
  if (unique.length === 0) return {};

  const prompt =
    TRANSLATE_STYLE_SHORT +
    " Translate Thai car-work item labels into the shortest practical English for workshop staff. " +
    PHOTO_REF_RULE_LABEL +
    " Keep model names, numbers, sizes, and codes unchanged. " +
    "If already English, keep as-is. " +
    "Return JSON only in this shape: {\"translations\":{\"<exact source label>\":\"<english>\"}}. " +
    "Keys in translations MUST match the input label strings exactly (same characters).\n\n" +
    JSON.stringify({ labels: unique }, null, 2);

  const modelCandidates = Array.from(
    new Set([
      geminiModel(),
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-1.5-flash",
    ])
  ).filter(Boolean);

  for (const model of modelCandidates) {
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
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const json = (await res.json()) as {
      error?: { message?: string };
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    if (!res.ok) {
      console.warn("[item-name-translation] Gemini HTTP error:", model, json.error?.message ?? res.statusText);
      continue;
    }

    const text = String(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    if (!text) continue;
    const parsed = parseJsonContent(text);
    if (parsed == null) continue;

    const obj = extractTranslationsRecord(parsed);
    const out = mapSourcesToEnglish(obj, unique);
    if (Object.keys(out).length > 0) return out;
  }

  return {};
}

export async function buildItemNameEnglishMap(labels: string[]): Promise<Record<string, string>> {
  const uniq = uniqueTrimmed(labels);
  if (uniq.length === 0) return {};

  const out: Record<string, string> = {};
  for (const src of uniq) {
    if (looksMostlyEnglish(src)) {
      const normalized = harmonizeRefPicToken(src);
      if (normalized && normalized.toLowerCase() !== src.toLowerCase()) out[src] = normalized;
    }
  }

  const needLlm = uniq.filter((src) => !looksMostlyEnglish(src));
  if (needLlm.length === 0) return out;

  let merged: Record<string, string> = {};

  /** Gemini มักแม่นข้อความไทยกว่า — ลองก่อน */
  if (geminiApiKey()) {
    try {
      merged = await translateBatchWithGemini(needLlm);
    } catch (e) {
      console.warn("[item-name-translation] Gemini batch threw:", e);
    }
  }

  const stillMissing = needLlm.filter((src) => !String(merged[src] ?? "").trim());
  if (stillMissing.length > 0 && groqApiKey()) {
    try {
      const groqMap = await translateBatchWithGroq(stillMissing);
      merged = { ...merged, ...groqMap };
    } catch (e) {
      console.warn("[item-name-translation] Groq batch threw:", e);
    }
  }

  for (const src of needLlm) {
    const en = harmonizeRefPicToken(merged[src] ?? "");
    if (!en) continue;
    out[src] = en;
  }

  return out;
}

export async function translateItemNameToEnglish(label: string): Promise<string | null> {
  const src = cleanText(label);
  if (!src) return null;
  if (looksMostlyEnglish(src)) {
    const normalized = harmonizeRefPicToken(src);
    return normalized.toLowerCase() === src.toLowerCase() ? null : normalized;
  }
  const map = await buildItemNameEnglishMap([src]);
  let en = cleanText(map[src] ?? "");
  if (!en && hasThaiScript(src)) {
    en = cleanText((await translatePlainGemini(src)) ?? "");
  }
  if (!en && hasThaiScript(src)) {
    en = cleanText((await translatePlainGroq(src)) ?? "");
  }
  return en || null;
}

/** แปลข้อความหมายเหตุรายการ (หลายบรรทัดได้) — ไม่ตัดเหลือบรรทัดเดียว */
async function translateNotePlainGemini(note: string): Promise<string | null> {
  const apiKey = geminiApiKey();
  if (!apiKey) return null;
  const src = String(note ?? "").trim().replace(/\r\n/g, "\n");
  if (!src || !hasThaiScript(src)) return null;

  const prompt =
    TRANSLATE_STYLE_SHORT +
    " Translate the following Thai automobile workshop order-item remark/note into clear practical English. " +
    PHOTO_REF_RULE_NOTE +
    " Preserve numbers, dates, amounts, plate/chassis codes, shop names, and emoji. " +
    "Keep line breaks where helpful. Reply with ONLY the English translation, no quotes or preamble.\n\n" +
    src;

  const modelCandidates = Array.from(
    new Set([
      geminiModel(),
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-1.5-flash",
    ])
  ).filter(Boolean);

  for (const model of modelCandidates) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const json = (await res.json()) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!res.ok) {
      console.warn("[item-name-translation] Gemini note HTTP error:", model, json.error?.message ?? res.statusText);
      continue;
    }

    let text = String(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    text = text.replace(/^[\s"'「『]+/u, "").replace(/[\s"'」』]+$/u, "").trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/u, "").trim();
    }
    const cleaned = ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(text), src);
    if (cleaned && normNoteCompare(cleaned) !== normNoteCompare(src)) return cleaned;
  }
  return null;
}

async function translateNotePlainGroq(note: string): Promise<string | null> {
  const apiKey = groqApiKey();
  if (!apiKey) return null;
  const src = String(note ?? "").trim().replace(/\r\n/g, "\n");
  if (!src || !hasThaiScript(src)) return null;

  const user =
    TRANSLATE_STYLE_SHORT +
    " Translate this Thai automobile workshop order-item remark to clear English. " +
    PHOTO_REF_RULE_NOTE +
    " Preserve numbers, dates, codes, and emoji. Reply with English text only, no quotes.\n\n" +
    src;

  const modelCandidates = Array.from(
    new Set([groqModel(), "llama-3.3-70b-versatile", "llama-3.1-70b-versatile"])
  ).filter(Boolean);

  for (const model of modelCandidates) {
    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.15,
          max_tokens: 8192,
          messages: [{ role: "user", content: user }],
        }),
      });
    } catch (e) {
      console.warn("[item-name-translation] Groq note fetch failed:", model, e);
      continue;
    }

    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!res.ok) {
      console.warn("[item-name-translation] Groq note HTTP error:", model, json.error?.message ?? res.statusText);
      continue;
    }

    let text = String(json.choices?.[0]?.message?.content ?? "").trim();
    text = text.replace(/^[\s"'「『]+/u, "").replace(/[\s"'」』]+$/u, "").trim();
    const cleaned = ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(text), src);
    if (cleaned && normNoteCompare(cleaned) !== normNoteCompare(src)) return cleaned;
  }
  return null;
}

/** แปลหมายเหตุรายการไทย → อังกฤษ (เก็บใน order_items.note_en) */
export async function translateOrderItemNoteToEnglish(note: string): Promise<string | null> {
  const src = String(note ?? "").trim().replace(/\r\n/g, "\n");
  if (!src || !hasThaiScript(src)) return null;
  let en = await translateNotePlainGemini(src);
  if (!en) en = await translateNotePlainGroq(src);
  return en || null;
}

/** แปลชุดหมายเหตุที่ไม่ซ้ำ — ใช้ปุ่ม Translate EN บนการ์ด */
export async function buildOrderItemNotesEnglishMap(notes: string[]): Promise<Record<string, string>> {
  const uniq = uniqueTrimmed(notes.filter((n) => hasThaiScript(n)));
  if (uniq.length === 0) return {};

  const entries = await Promise.all(
    uniq.map(async (src) => {
      const en = await translateOrderItemNoteToEnglish(src);
      return en ? ([src, en] as const) : null;
    })
  );

  const out: Record<string, string> = {};
  for (const e of entries) {
    if (e) out[e[0]] = e[1];
  }
  return out;
}

export type CarSummarySourceFields = {
  cost_detail: string;
  repair_detail: string;
  document_detail: string;
};

export type CarSummaryEnglishFields = {
  cost_detail_en: string;
  repair_detail_en: string;
  document_detail_en: string;
};

/** แปลข้อความยาวในแผง Cost Summary (รถ) — เก็บเลข/วันที่/รหัส */
export async function translateCarSummaryBlocksToEnglish(
  input: CarSummarySourceFields
): Promise<CarSummaryEnglishFields> {
  const cost = cleanText(input.cost_detail);
  const repair = cleanText(input.repair_detail);
  const doc = cleanText(input.document_detail);

  const passthrough: CarSummaryEnglishFields = {
    cost_detail_en: cost,
    repair_detail_en: repair,
    document_detail_en: doc,
  };

  const needsCost = cost.length > 0 && hasThaiScript(cost);
  const needsRepair = repair.length > 0 && hasThaiScript(repair);
  const needsDoc = doc.length > 0 && hasThaiScript(doc);
  if (!needsCost && !needsRepair && !needsDoc) {
    return passthrough;
  }

  const payloadIn = { cost_detail: cost, repair_detail: repair, document_detail: doc };

  const sys =
    TRANSLATE_STYLE_SHORT +
    " You translate Thai automotive dealership / workshop CRM notes into clear English. " +
    PHOTO_REF_RULE_NOTE +
    " Preserve numbers, dates, amounts (baht or THB), plate/chassis codes, shop or company names, and emoji. " +
    "Return only JSON with keys cost_detail_en, repair_detail_en, document_detail_en (strings). " +
    "If a source field has no Thai, copy it unchanged to the matching _en field. Use empty string when source is empty.";

  const userBlock = "Input JSON:\n" + JSON.stringify(payloadIn, null, 2);
  const geminiPrompt = `${sys}\n\n${userBlock}`;

  const apiKey = geminiApiKey();
  if (apiKey) {
    const modelCandidates = Array.from(
      new Set([
        geminiModel(),
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-1.5-flash",
      ])
    ).filter(Boolean);

    for (const model of modelCandidates) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
            },
            contents: [{ parts: [{ text: geminiPrompt }] }],
          }),
        }
      );

      const json = (await res.json()) as {
        error?: { message?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      if (!res.ok) {
        console.warn("[item-name-translation] car summary Gemini HTTP:", model, json.error?.message ?? res.statusText);
        continue;
      }

      const text = String(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      if (!text) continue;
      const parsed = parseJsonContent(text) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== "object") continue;

      const rawC = cleanText(String(parsed.cost_detail_en ?? ""));
      const rawR = cleanText(String(parsed.repair_detail_en ?? ""));
      const rawD = cleanText(String(parsed.document_detail_en ?? ""));
      return {
        cost_detail_en: needsCost
          ? ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(rawC), cost) || cost
          : cost,
        repair_detail_en: needsRepair
          ? ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(rawR), repair) || repair
          : repair,
        document_detail_en: needsDoc
          ? ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(rawD), doc) || doc
          : doc,
      };
    }
  }

  const groqKey = groqApiKey();
  if (groqKey) {
    const modelCandidates = Array.from(
      new Set([groqModel(), "llama-3.3-70b-versatile", "llama-3.1-70b-versatile"])
    ).filter(Boolean);

    for (const model of modelCandidates) {
      let res: Response;
      try {
        res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.15,
            max_tokens: 8192,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userBlock },
            ],
          }),
        });
      } catch (e) {
        console.warn("[item-name-translation] car summary Groq fetch failed:", model, e);
        continue;
      }

      const json = (await res.json()) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
      };
      if (!res.ok) {
        console.warn("[item-name-translation] car summary Groq HTTP:", model, json.error?.message ?? res.statusText);
        continue;
      }

      const content = String(json.choices?.[0]?.message?.content ?? "").trim();
      const parsed = parseJsonContent(content) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== "object") continue;

      const rawC = cleanText(String(parsed.cost_detail_en ?? ""));
      const rawR = cleanText(String(parsed.repair_detail_en ?? ""));
      const rawD = cleanText(String(parsed.document_detail_en ?? ""));
      return {
        cost_detail_en: needsCost
          ? ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(rawC), cost) || cost
          : cost,
        repair_detail_en: needsRepair
          ? ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(rawR), repair) || repair
          : repair,
        document_detail_en: needsDoc
          ? ensureFallbackPhotoMarkers(harmonizeRefPicTokenPreserveBlocks(rawD), doc) || doc
          : doc,
      };
    }
  }

  return passthrough;
}
