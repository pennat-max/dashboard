import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchCarsForOrderTracking } from "@/lib/data/cars";
import {
  carsMatchingQuery,
  parseUrgentLinePaste,
  suggestSearchQueryFromVehicleLine,
} from "@/lib/orders/urgent-line-intake";
import type { Car } from "@/types/car";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";

/** ค่าเริ่มต้นเมื่อไม่ตั้ง GEMINI_MODEL — โมเดลเบา ราคาถูก */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

/** ชื่อสั้น (เช่น gemini-1.5-flash) มักไม่มีใน v1beta — map เป็นรหัสที่ generateContent รองรับ */
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

/** โหลดสูง / rate limit — ลองซ้ำหรือสลับโมเดลได้ */
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

/** โมเดลสำรองเมื่อตัวหลักเต็มคิว — คั่นด้วย comma หรือเว้นวรรค */
function geminiFallbackModelList(primary: string): string[] {
  const fromEnv = (process.env.GEMINI_FALLBACK_MODELS ?? "").trim();
  if (fromEnv) {
    return uniqueModelOrder([primary, ...fromEnv.split(/[,\s]+/).filter(Boolean)]);
  }
  return uniqueModelOrder([primary, "gemini-2.0-flash", "gemini-2.5-flash"]);
}

/** ดึงข้อความ JSON จากตอบ Gemini (บางครั้งห่อด้วย ```json) */
function extractModelJsonText(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/im.exec(t);
  if (fence) return fence[1].trim();
  return t;
}

type CandidatePayload = {
  row_id: string | null;
  car_id: number | null;
  plate: string;
  chassis: string;
  existing_labels: string[];
};

async function loadExistingLabelsForCar(
  supabase: ReturnType<typeof createServiceRoleClient>,
  car: Car
): Promise<string[]> {
  const rowId = String(car.row_id ?? "").trim();
  const cid = car.id;
  const carId = typeof cid === "number" && Number.isFinite(cid) ? cid : Number.isFinite(Number(cid)) ? Number(cid) : null;

  let tq = supabase.from(ORDER_TASKS_TABLE).select("id").order("updated_at", { ascending: false, nullsFirst: false }).limit(1);
  if (rowId) tq = tq.eq("car_row_id", rowId);
  else if (carId != null) tq = tq.eq("car_id", carId);
  else return [];

  const { data: task, error: taskErr } = await tq.maybeSingle();
  if (taskErr || !task) return [];
  const taskId = String((task as { id?: string }).id ?? "").trim();
  if (!taskId) return [];

  const { data: rows, error: itemErr } = await supabase.from(ORDER_ITEMS_TABLE).select("label").eq("order_task_id", taskId);
  if (itemErr || !rows) return [];
  return (rows as { label?: string }[]).map((r) => String(r.label ?? "").trim()).filter(Boolean);
}

type AiItemKind = "work" | "parts";

type AiItem = {
  label: string;
  kind: AiItemKind;
  existing_match: string;
  matched_existing_label: string | null;
};

type AiShape = {
  chosen_car_row_id: string | null;
  chosen_car_id: number | null;
  plate_summary_th: string;
  plate_search_query: string;
  items: AiItem[];
  confidence_note_th: string;
};

function parseOneAiItemRow(x: unknown, kind: AiItemKind): AiItem | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const label = String(r.label ?? "").trim();
  if (!label) return null;
  const em = String(r.existing_match ?? "new").toLowerCase();
  const existing_match = em === "duplicate" || em === "similar" ? em : "new";
  const matched = r.matched_existing_label != null ? String(r.matched_existing_label).trim() || null : null;
  const kindRaw = String(r.kind ?? "").toLowerCase();
  const resolvedKind: AiItemKind = kindRaw === "parts" || kindRaw === "part" || kindRaw === "accessory" ? "parts" : kind;
  return { label, kind: resolvedKind, existing_match, matched_existing_label: matched };
}

function parseAiItemList(arr: unknown, defaultKind: AiItemKind): AiItem[] {
  if (!Array.isArray(arr)) return [];
  const out: AiItem[] = [];
  for (const x of arr) {
    const row = parseOneAiItemRow(x, defaultKind);
    if (row) out.push(row);
  }
  return out;
}

function safeParseAiJson(text: string): AiShape | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;

    const fromSplit = [...parseAiItemList(o.work_items, "work"), ...parseAiItemList(o.parts_items, "parts")];
    const legacy = parseAiItemList(o.items, "work");
    const items = fromSplit.length > 0 ? fromSplit : legacy;
    if (!items.length) return null;

    const pq =
      String(o.plate_search_query ?? o.plate_for_search ?? o.plate_query ?? "")
        .replace(/\s+/g, " ")
        .trim() || "";

    return {
      chosen_car_row_id: o.chosen_car_row_id != null ? String(o.chosen_car_row_id).trim() || null : null,
      chosen_car_id:
        o.chosen_car_id != null && Number.isFinite(Number(o.chosen_car_id)) ? Number(o.chosen_car_id) : null,
      plate_summary_th: String(o.plate_summary_th ?? "").trim() || "—",
      plate_search_query: pq,
      items,
      confidence_note_th: String(o.confidence_note_th ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await requireMutateRole();
  if (!auth.ok) return auth.response;

  const key = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        code: "no_gemini",
        message:
          "ตั้ง GEMINI_API_KEY ใน .env.local (หรือ Vercel env) จาก https://aistudio.google.com/apikey แล้วรีสตาร์ทเซิร์ฟเวอร์",
      },
      { status: 503 }
    );
  }

  let body: { raw?: string; car_row_id?: string | null; car_id?: number | string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = String(body.raw ?? "").trim();
  if (!raw) return NextResponse.json({ error: "raw required" }, { status: 400 });
  const bodyRowId = String(body.car_row_id ?? "").trim() || null;
  const bodyCarIdRaw = body.car_id;
  const bodyCarId =
    bodyCarIdRaw != null && String(bodyCarIdRaw).trim() !== "" && Number.isFinite(Number(bodyCarIdRaw))
      ? Number(bodyCarIdRaw)
      : null;

  const parsed = parseUrgentLinePaste(raw.slice(0, 12000));
  const q = suggestSearchQueryFromVehicleLine(parsed.vehicleLine);

  const { cars, error: carsErr } = await fetchCarsForOrderTracking();
  if (carsErr) {
    return NextResponse.json({ ok: false, error: carsErr }, { status: 500 });
  }

  const candidates = carsMatchingQuery(cars, q).slice(0, 10);
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const candidatePayload: CandidatePayload[] = await Promise.all(
    candidates.map(async (car) => ({
      row_id: car.row_id != null && String(car.row_id).trim() ? String(car.row_id).trim() : null,
      car_id: typeof car.id === "number" && Number.isFinite(car.id) ? car.id : Number.isFinite(Number(car.id)) ? Number(car.id) : null,
      plate: String(car.plate_number ?? "").trim(),
      chassis: String(car.chassis_number ?? "").trim(),
      existing_labels: await loadExistingLabelsForCar(supabase, car),
    }))
  );

  let focusedCar: Car | null = null;
  if (bodyRowId) focusedCar = cars.find((c) => String(c.row_id ?? "").trim() === bodyRowId) ?? null;
  if (!focusedCar && bodyCarId != null) focusedCar = cars.find((c) => Number(c.id) === bodyCarId) ?? null;
  const existing_order_labels_user_focused_car =
    focusedCar != null ? await loadExistingLabelsForCar(supabase, focusedCar) : null;

  const system = `คุณวิเคราะห์ข้อความ LINE เกี่ยวกับรถ/งานแต่งในประเทศไทย แม้รูปแบบประโยคจะยาว สลับหัวท้าย หรือไม่มีขีดนำหน้า

ขั้นตอน (ทำตามลำดับ):
1) แยก "ทะเบียน/เลขถัง/ตัวระบุรถ" ออกจากประโยค — อาจซ่อนในประโยคยาว มีคำว่า ทะเบียน ป้าย กทม หรือไม่มีคำนำก็ได้
2) สร้าง plate_search_query: สตริงสั้นที่ใช้ค้นหารถในระบบ (เน้นตัวเลขทะเบียน เช่น กข-1234 หรือ 71331 หรือเลขถังย่อที่อ่านได้) ถ้าไม่มั่นใจให้ใส่สิ่งที่ดีที่สุดที่มี
3) เลือกรถจาก candidates (row_id / car_id) ให้สอดคล้องกับ plate_search_query — ถ้าไม่มั่นใจ chosen_car_row_id = null
4) จากข้อความทั้งก้อน แยกรายการเป็น 2 กลุ่ม (อาจไม่มีขีดนำหน้า — ให้แตกเป็นบรรทัดงานเอง):
   - work_items = งานบริการ / ให้ช่างทำ / ติดตั้ง / เช็ค / พ่นสี / ล้าง ฯลฯ (ไม่ใช่ของชิ้น)
   - parts_items = อะไหล่ / ของแต่ง / ชิ้นส่วน / ยาง / โช้ค / กันชน / โคมไฟ ฯลฯ
5) เทียบแต่ละรายการใน work_items และ parts_items กับรายการเก่าในระบบ (ลำดับเดียวกับข้อ 4 ใน user JSON):
   - ถ้ามี existing_order_labels_user_focused_car ให้ใช้เป็นรายการเก่าหลัก
   - ไม่งั้นใช้ existing_labels ของ candidate ที่เลือกเป็นรถ
   กำหนด existing_match: duplicate | similar | new และ matched_existing_label เมื่อจับคู่ได้
6) ตอบเป็น JSON เท่านั้น ฟิลด์:
chosen_car_row_id (string|null), chosen_car_id (number|null),
plate_summary_th (string สั้นๆ ภาษาไทย),
plate_search_query (string สั้น สำหรับช่องค้นหาทะเบียน),
work_items: [{label, existing_match, matched_existing_label}],
parts_items: [{label, existing_match, matched_existing_label}],
confidence_note_th (string สั้นๆ ภาษาไทย)

หมายเหตุ: label ต้องเป็นข้อความที่อ่านจากข้อความผู้ใช้จริง ไม่ตัดทิ้งถ้าไม่แน่ใจให้ใส่ในกลุ่มที่ใกล้เคียงที่สุด`;

  const pasteWorkItems = parsed.items.map((s) => String(s).trim()).filter(Boolean);

  const userContent = JSON.stringify(
    {
      noisy_line_paste: raw.slice(0, 12000),
      heuristic_vehicle_line: parsed.vehicleLine,
      paste_work_items: pasteWorkItems,
      heuristic_items: parsed.items,
      existing_order_labels_user_focused_car,
      note_user_focused_car:
        existing_order_labels_user_focused_car != null
          ? "ผู้ใช้เลือกรถใน UI แล้ว — ใช้ existing_order_labels_user_focused_car เป็นรายการเก่าในระบบเทียบกับ paste_work_items (และควรเลือกรถคันนี้ถ้าสอดคล้องกับข้อความ)"
          : null,
      candidates: candidatePayload,
    },
    null,
    0
  );

  const primaryModel = resolveGeminiModelId(process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
  const modelCandidates = geminiFallbackModelList(primaryModel);
  const geminiRequestBody = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    generationConfig: {
      temperature: 0.15,
      responseMimeType: "application/json",
    },
  };

  try {
    let lastStatus = 502;
    let lastMsg = "";
    let text = "";

    outer: for (const tryModel of modelCandidates) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await delay(350 * attempt + 150);
        const url = `${geminiGenerateUrl(tryModel)}?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiRequestBody),
        });

        const rawJson = (await res.json()) as {
          error?: { message?: string; status?: string };
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const msg = rawJson.error?.message ?? rawJson.error?.status ?? res.statusText;
        lastStatus = res.status;
        lastMsg = msg;

        const parts = rawJson.candidates?.[0]?.content?.parts;
        const chunk = Array.isArray(parts) ? parts.map((p) => String(p.text ?? "")).join("") : "";

        if (res.ok && chunk.trim()) {
          text = chunk;
          break outer;
        }

        if (res.ok && !chunk.trim()) {
          break;
        }

        if (isRetryableGeminiOverload(res.status, msg) && attempt < 2) continue;
        if (isRetryableGeminiOverload(res.status, msg)) break;
        return NextResponse.json({ ok: false, error: msg }, { status: 502 });
      }
    }

    if (!text.trim()) {
      const overload =
        isRetryableGeminiOverload(lastStatus, lastMsg) || /high demand|try again later/i.test(lastMsg);
      const friendly = overload
        ? "เซิร์ฟเวอร์ Gemini คิวเยอะชั่วคราว — ลองกดใหม่ในอีกสักครู่ หรือตั้ง GEMINI_MODEL / GEMINI_FALLBACK_MODELS ใน .env.local (เช่น gemini-2.0-flash)"
        : lastMsg ||
          "Gemini ไม่ส่งข้อความกลับ — ลองเปลี่ยน GEMINI_MODEL หรือตรวจสิทธิ์ API key";
      return NextResponse.json({ ok: false, error: friendly }, { status: overload ? 503 : 502 });
    }

    const ai = safeParseAiJson(extractModelJsonText(text));
    if (!ai || !Array.isArray(ai.items)) {
      return NextResponse.json({ ok: false, error: "AI response JSON invalid" }, { status: 502 });
    }

    let chosenCar: Car | null = null;
    if (ai.chosen_car_row_id) {
      chosenCar =
        candidates.find((c) => String(c.row_id ?? "").trim() === ai.chosen_car_row_id) ?? null;
    }
    if (!chosenCar && ai.chosen_car_id != null) {
      chosenCar =
        candidates.find((c) => Number(c.id) === ai.chosen_car_id || String(c.id) === String(ai.chosen_car_id)) ?? null;
    }

    let chosenExistingLabels: string[] = [];
    if (chosenCar) {
      const hit = candidatePayload.find(
        (p) =>
          (p.row_id && String(chosenCar!.row_id ?? "").trim() === p.row_id) ||
          (p.car_id != null &&
            chosenCar!.id != null &&
            (Number(chosenCar!.id) === p.car_id || String(chosenCar!.id) === String(p.car_id)))
      );
      if (hit?.existing_labels?.length) chosenExistingLabels = hit.existing_labels;
      else chosenExistingLabels = await loadExistingLabelsForCar(supabase, chosenCar);
    }

    const existing_labels_for_chosen_car =
      chosenCar != null ? chosenExistingLabels : (existing_order_labels_user_focused_car ?? []);

    return NextResponse.json({
      ok: true,
      heuristic: { vehicleLine: parsed.vehicleLine, items: parsed.items },
      ai: {
        plate_summary_th: ai.plate_summary_th,
        plate_search_query: ai.plate_search_query,
        confidence_note_th: ai.confidence_note_th,
        items: ai.items,
        existing_labels_for_chosen_car,
        chosen_car_row_id: chosenCar ? String(chosenCar.row_id ?? "").trim() || null : null,
        chosen_car_id:
          chosenCar && chosenCar.id != null && Number.isFinite(Number(chosenCar.id)) ? Number(chosenCar.id) : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
