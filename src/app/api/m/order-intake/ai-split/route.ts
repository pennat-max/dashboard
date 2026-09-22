import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";

type Body = {
  text?: string;
  existing_items?: string[];
};

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.1-70b-versatile";

function sanitizeLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function heuristicSplit(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const mentions = line.match(/@\S+/g) ?? [];
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    if (mentions.length >= 2 && mentions.length * 2 >= wordCount) continue;
    if (mentions.length >= 1 && wordCount <= 2) continue;

    const hasThaiPlateLike = /[ก-ฮ]{1,3}[-\s]?\d{1,4}/.test(line);
    const hasVehicleSpecToken =
      /(REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|2WD|4WD|AT|MT|DOUBLE[_\s-]?CAB|SILVER|BLACK|WHITE|GRAY|GREY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(
        line
      );
    if (hasThaiPlateLike && hasVehicleSpecToken) continue;
    if (/^[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{1,4}$/i.test(line)) continue;
    const hasChassisKeyword = /(chassis|vin|เลขถัง|ตัวถัง)/i.test(line);
    const hasLongVinToken = /[a-z0-9-]{10,}/i.test(line);
    if (hasChassisKeyword || hasLongVinToken) continue;

    if (/^[a-zA-Z][a-zA-Z0-9 _-]{0,22}$/.test(line)) continue;

    out.push(line);
  }

  const uniq = new Set<string>();
  const dedup: string[] = [];
  for (const l of out.map(sanitizeLine)) {
    const key = l.toLowerCase();
    if (uniq.has(key)) continue;
    uniq.add(key);
    dedup.push(l);
  }
  return dedup.slice(0, 60);
}

async function groqSplit(text: string, existing: string[]): Promise<string[]> {
  const sys =
    "You extract a clean list of task items from messy LINE chat text. " +
    "Return ONLY JSON {\"lines\":[...]} with Thai task lines. " +
    "Remove mentions (@...), vehicle headers/plate/spec lines, chassis/VIN lines, names, and empty lines. " +
    "Keep each task as a short standalone line. Do not add numbering or bullets.";
  const user =
    `TEXT:\n${text}\n\n` +
    `EXISTING_ITEMS (for reference, might be duplicates):\n${existing.join("\n")}\n\n` +
    "Return JSON with key lines.";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!res.ok) throw new Error(json.error?.message ?? res.statusText);
  const content = String(json.choices?.[0]?.message?.content ?? "").trim();
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as { lines?: unknown };
    const lines = Array.isArray(parsed.lines) ? parsed.lines.map((x) => sanitizeLine(String(x ?? ""))).filter(Boolean) : [];
    return Array.from(new Set(lines)).slice(0, 60);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const existing = Array.isArray(body.existing_items) ? body.existing_items.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

  try {
    if (GROQ_API_KEY) {
      const lines = await groqSplit(text, existing);
      if (lines.length) return NextResponse.json({ ok: true, lines });
    }
    return NextResponse.json({ ok: true, lines: heuristicSplit(text) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    /** ถ้า AI พังให้ fallback */
    return NextResponse.json({ ok: true, lines: heuristicSplit(text), warning: msg });
  }
}

