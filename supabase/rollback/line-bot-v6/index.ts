// ============================================================
// VIGO4U LINE Bot — เลขาอัจฉริยะธุรกิจส่งออกรถยนต์มือสอง
// Version 5.0 — Gemini with retry + Smart Keyword Parser
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ===== Config =====
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const LINE_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SB_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BOT_USER_ID = "Ufcf7e759bc66724344053f367bba97b9";
const MAX_HISTORY = 10;
const HISTORY_TTL_HOURS = 2;

const sb = createClient(SB_URL, SB_KEY);

// Gemini model fallback chain
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

// ===== Signature Verification =====
async function verifySig(body: string, sig: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(LINE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const s = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    return btoa(String.fromCharCode(...new Uint8Array(s))) === sig;
  } catch { return false; }
}

// ===== LINE Reply =====
async function reply(token: string, text: string) {
  const msgs: Array<{type: string; text: string}> = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 4800) { msgs.push({ type: "text", text: remaining }); break; }
    let cut = remaining.lastIndexOf("\n", 4800);
    if (cut < 2000) cut = 4800;
    msgs.push({ type: "text", text: remaining.substring(0, cut) });
    remaining = remaining.substring(cut).trim();
    if (msgs.length >= 5) { msgs[msgs.length - 1].text += "\n\n...(ข้อมูลมากเกินไป กรุณาระบุเงื่อนไขเพิ่ม)"; break; }
  }
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ replyToken: token, messages: msgs }),
    });
    console.log(`Reply: ${r.status} (${msgs.length} msg, ${text.length} chars)`);
  } catch (e) { console.error("Reply err:", e); }
}

// ===== Chat History =====
async function getHistory(userId: string): Promise<Array<{role: string; content: string}>> {
  try {
    const cutoff = new Date(Date.now() - HISTORY_TTL_HOURS * 3600000).toISOString();
    const { data } = await sb.from("chat_history").select("role,content").eq("user_id", userId).gte("created_at", cutoff).order("created_at", { ascending: true }).limit(MAX_HISTORY);
    return data ?? [];
  } catch (e) { console.error("History get err:", e); return []; }
}

async function saveHistory(userId: string, role: string, content: string) {
  try {
    await sb.from("chat_history").insert({ user_id: userId, role, content: content.substring(0, 2000) });
    const { data: all } = await sb.from("chat_history").select("id").eq("user_id", userId).order("created_at", { ascending: false });
    if (all && all.length > MAX_HISTORY) {
      const idsToDelete = all.slice(MAX_HISTORY).map((r: {id: number}) => r.id);
      await sb.from("chat_history").delete().in("id", idsToDelete);
    }
  } catch (e) { console.error("History save err:", e); }
}

// ===== Data Fetching =====
const DETAIL_COLS = "spec,status,picture,advance_date,income_date,plate_number,province,brand,drive_type,engine_size,grade,gear_type,cabin,color,manufacture,registration,engine_number,chassis_number,mileage,agent,inspector,driver_location,initial_document,document_status,doc_fee,repair_cost,repair_details,advance,buy_price,total_cost,part_accessories,web_price_usd,bf_on_web,requested_modifications,free,booked_date,sale_price_usd,buyer,sale_support,remarks,booked_shipping,destination_port,other,shipped,country,month,c_year,model,model_year";
const LIST_COLS = "spec,status,plate_number,brand,drive_type,engine_size,grade,gear_type,cabin,color,manufacture,mileage,buy_price,total_cost,web_price_usd,sale_price_usd,buyer,country,destination_port,model,model_year,chassis_number";
const STATS_COLS = "brand,status,drive_type,gear_type,cabin,color,country,buyer,sale_price_usd,buy_price,total_cost,agent,sale_support,manufacture,model_year";

async function fetchByPlateOrChassis(query: string) {
  let { data } = await sb.from("cars").select(DETAIL_COLS).ilike("plate_number", `%${query}%`).limit(5);
  if (!data || data.length === 0) {
    const r = await sb.from("cars").select(DETAIL_COLS).ilike("chassis_number", `%${query}%`).limit(5);
    data = r.data;
  }
  if (!data || data.length === 0) {
    const r = await sb.from("cars").select(DETAIL_COLS).ilike("spec", `%${query}%`).limit(5);
    data = r.data;
  }
  return data ?? [];
}

async function fetchFiltered(filters: Record<string, string>, limit = 20) {
  let q = sb.from("cars").select(LIST_COLS, { count: "exact" });
  for (const [col, val] of Object.entries(filters)) {
    if (val) q = q.ilike(col, `%${val}%`);
  }
  const { data, count, error } = await q.limit(limit);
  if (error) console.error("Query err:", error);
  return { data: data ?? [], count: count ?? 0 };
}

async function fetchAllForStats() {
  const { data } = await sb.from("cars").select(STATS_COLS);
  return data ?? [];
}

// ===== Gemini AI with retry + model fallback =====
async function askGemini(
  userMessage: string,
  chatHistory: Array<{role: string; content: string}>,
  carData: string
): Promise<string> {
  const systemPrompt = `คุณคือ "VIGO4U" เลขาอัจฉริยะของธุรกิจส่งออกรถยนต์มือสอง (กระบะ, SUV, รถเพื่อการพาณิชย์) จากประเทศไทย

🎯 บทบาท: เลขาส่วนตัวเชี่ยวชาญเรื่องรถ ตอบมืออาชีพ สุภาพ กระชับ เข้าใจง่าย

📋 กฎสำคัญ:
1. ตอบภาษาเดียวกับผู้ใช้ (ไทย/อังกฤษ)
2. ตอบกระชับ เหมาะกับ LINE chat (ไม่เกิน 1500 ตัวอักษร)
3. ใช้ emoji เล็กน้อย (🚗📊✅❌💰🔍)
4. แสดงรายการรถแค่ 8 คันแรก แล้วบอกจำนวนทั้งหมด
5. ห้ามแต่งข้อมูลเอง ต้องอ้างอิงจากข้อมูลที่ให้เท่านั้น
6. ถ้าไม่เข้าใจ → ถามกลับสุภาพ อย่าตอบ "ไม่พบ" ทันที
7. เดาคำไม่ครบ: "รีโว" = REVO, "เรนเจ" = RANGER, "แร็พ" = RAPTOR
8. จำบริบทจากประวัติแชท
9. ถ้าถามเรื่องไม่เกี่ยวกับรถ → ตอบสุภาพว่าช่วยได้เฉพาะเรื่องรถ
10. ถ้าผู้ใช้ขอดูความหมายคอลัมน์ → อธิบายคอลัมน์สำคัญ

🧮 คำนวณกำไร: sale_price_usd - total_cost (1 USD ≈ 33 THB)

📦 คอลัมน์สำคัญ:
spec=สเปครวม | status=สถานะ(1.Ready/Comming/Advance/Check Doc/P.Office/2.Confirm/3.Cancel) | plate_number=ทะเบียน | brand=ยี่ห้อ | drive_type=ขับเคลื่อน | engine_size=เครื่องยนต์ | grade=เกรด | gear_type=เกียร์ | cabin=ตัวถัง | color=สี | manufacture=เดือน/ปีผลิต(เช่น Apr26=เม.ย.2026, 19=ปี2019) | mileage=ไมล์ | chassis_number=VIN | buy_price=ราคาซื้อ(บาท) | total_cost=ต้นทุนรวม | web_price_usd=ราคาเว็บ(USD) | sale_price_usd=ราคาขาย(USD) | buyer=ผู้ซื้อ | country=ประเทศปลายทาง | destination_port=ท่าเรือ | agent=ตัวแทน | sale_support=ฝ่ายขาย | model_year=รุ่น+ปี

🏷️ ยี่ห้อ: REVO,VIGO,RANGER,RAPTOR,MU_X,TRAVO,FORTUNER,DMAX,TRITON,ROCCO,EVEREST,TIGER,HILUX_Champ,GR,COMMUTER,HONDA,MAZDA,MG,NISSAN,CHEVROLET,TRAILBLAZER,RANGER_DUTY`;

  const contents: Array<{role: string; parts: Array<{text: string}>}> = [];
  for (const h of chatHistory) {
    contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] });
  }
  const userPart = carData
    ? `[ข้อมูลรถจากฐานข้อมูล]\n${carData}\n\n[คำถามผู้ใช้]\n${userMessage}`
    : userMessage;
  contents.push({ role: "user", parts: [{ text: userPart }] });

  // Try each model with retry
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
          }),
        });

        if (resp.status === 429) {
          console.log(`Gemini ${model} rate limited (attempt ${attempt + 1})`);
          if (attempt === 0) await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        if (!resp.ok) {
          const err = await resp.text();
          console.error(`Gemini ${model} ${resp.status}: ${err.substring(0, 150)}`);
          break; // Try next model
        }

        const result = await resp.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          console.log(`Gemini OK (${model})`);
          return text;
        }
      } catch (e) {
        console.error(`Gemini ${model} err: ${e}`);
        break;
      }
    }
  }

  console.log("All Gemini models failed");
  return "";
}

// ===== Enhanced Keyword Parser =====
const BRAND_MAP: Record<string, string> = {
  "revo": "REVO", "รีโว่": "REVO", "รีโว": "REVO", "hilux": "REVO", "ไฮลักซ์": "REVO",
  "vigo": "VIGO", "วีโก้": "VIGO", "วีโก": "VIGO",
  "ranger": "RANGER", "เรนเจอร์": "RANGER", "เรนเจ": "RANGER",
  "raptor": "RAPTOR", "แร็พเตอร์": "RAPTOR", "แรปเตอร์": "RAPTOR", "แร็พ": "RAPTOR", "แรพ": "RAPTOR",
  "mu-x": "MU_X", "mu_x": "MU_X", "mux": "MU_X", "มิวเอ็กซ์": "MU_X", "มิวเอ็ก": "MU_X",
  "fortuner": "FORTUNER", "ฟอร์จูนเนอร์": "FORTUNER", "ฟอร์จูน": "FORTUNER",
  "d-max": "DMAX", "dmax": "DMAX", "ดีแม็ก": "DMAX", "ดีแม็ค": "DMAX",
  "triton": "TRITON", "ไทรทัน": "TRITON",
  "travo": "TRAVO", "ทราโว่": "TRAVO", "ทราโว": "TRAVO",
  "rocco": "ROCCO", "ร็อคโค่": "ROCCO", "ร็อคโค": "ROCCO",
  "everest": "EVEREST", "เอเวอเรสต์": "EVEREST",
  "tiger": "TIGER", "ไทเกอร์": "TIGER",
  "hilux champ": "HILUX_Champ", "champ": "HILUX_Champ", "แชมป์": "HILUX_Champ",
  "commuter": "COMMUTER", "คอมมิวเตอร์": "COMMUTER",
  "trailblazer": "TRAILBLAZER", "เทรลเบลเซอร์": "TRAILBLAZER",
  "ranger_duty": "RANGER_DUTY", "ranger duty": "RANGER_DUTY",
  "gr": "GR",
  "mg": "MG", "เอ็มจี": "MG",
  "honda": "HONDA", "ฮอนด้า": "HONDA",
  "mazda": "MAZDA", "มาสด้า": "MAZDA",
  "nissan": "NISSAN", "นิสสัน": "NISSAN",
  "chevrolet": "CHEVROLET", "เชฟโรเลต": "CHEVROLET", "เชฟ": "CHEVROLET",
};

const DRIVE_MAP: Record<string, string> = {
  "4wd": "4WD", "4x4": "4WD", "สี่ล้อ": "4WD", "ขับสี่": "4WD", "ขับ4": "4WD",
  "2wd": "2WD", "4x2": "2WD", "สองล้อ": "2WD", "ขับสอง": "2WD", "ขับ2": "2WD",
  "pre": "PRE", "prerunner": "PRE", "พรีรันเนอร์": "PRE", "พรี": "PRE",
  "hi-rider": "Hi_Rider", "hirider": "Hi_Rider", "ไฮไรเดอร์": "Hi_Rider",
  "hi-lander": "Hi_Lander", "hilander": "Hi_Lander",
  "hi-racer": "Hi_Racer", "hiracer": "Hi_Racer",
  "awd": "AWD",
};

const GEAR_MAP: Record<string, string> = {
  "at": "AT", "auto": "AT", "ออโต้": "AT", "อัตโนมัติ": "AT", "เกียร์ออโต้": "AT",
  "mt": "MT", "manual": "MT", "ธรรมดา": "MT", "เกียร์ธรรมดา": "MT",
};

const CABIN_MAP: Record<string, string> = {
  "double cab": "Double_Cab", "double_cab": "Double_Cab", "4ประตู": "Double_Cab", "4 ประตู": "Double_Cab", "สี่ประตู": "Double_Cab", "ดับเบิ้ลแค็บ": "Double_Cab",
  "smart cab": "Smart_Cab", "smart_cab": "Smart_Cab", "แค็บ": "Smart_Cab", "สมาร์ทแค็บ": "Smart_Cab",
  "standard": "Standard", "ตอนเดียว": "Standard", "หัวเดียว": "Standard",
  "suv": "SUV",
  "van": "VAN", "ตู้": "VAN",
};

const COLOR_MAP: Record<string, string> = {
  "ขาว": "WHITE", "white": "WHITE", "ดำ": "BLACK", "black": "BLACK",
  "เทา": "GRAY", "gray": "GRAY", "grey": "GRAY", "เทาเข้ม": "DARK_GRAY", "dark gray": "DARK_GRAY",
  "เงิน": "SILVER", "silver": "SILVER", "แดง": "RED", "red": "RED",
  "น้ำเงิน": "BLUE", "blue": "BLUE", "ส้ม": "ORANGE", "orange": "ORANGE",
  "เหลือง": "YELLOW", "yellow": "YELLOW", "น้ำตาล": "BROWN", "brown": "BROWN",
  "ทอง": "GOLD", "gold": "GOLD", "บรอนซ์": "BRONZE", "bronze": "BRONZE",
  "ขาวมุก": "PEARL_WHITE", "pearl white": "PEARL_WHITE",
};

const STATUS_MAP: Record<string, string> = {
  "ready": "1.Ready", "1.ready": "1.Ready", "พร้อม": "1.Ready", "พร้อมขาย": "1.Ready",
  "comming": "Comming", "coming": "Comming", "กำลังมา": "Comming",
  "advance": "Advance", "มัดจำ": "Advance",
  "confirm": "2.Confirm", "2.confirm": "2.Confirm", "ยืนยัน": "2.Confirm",
  "cancel": "3.Cancel", "3.cancel": "3.Cancel", "ยกเลิก": "3.Cancel",
  "check doc": "Check Doc", "ตรวจเอกสาร": "Check Doc",
  "p.office": "P.Office", "สำนักงาน": "P.Office",
  "sold": "2.Confirm",
};

function matchAlias(text: string, map: Record<string, string>): string | null {
  const lower = text.toLowerCase();
  // Sort by key length descending to match longer keys first
  const sorted = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of sorted) {
    if (lower.includes(k)) return v;
  }
  return null;
}

interface QueryPlan {
  type: "detail" | "search" | "count" | "summary" | "analysis" | "columns" | "chat";
  filters: Record<string, string>;
  searchText: string;
  originalMsg: string;
}

function planQuery(msg: string, history: Array<{role: string; content: string}>): QueryPlan {
  const lower = msg.toLowerCase().trim();
  const filters: Record<string, string> = {};

  // 0. Column/help questions
  if (/คอลัมน์|column|ความหมาย|หมายถึง|อธิบาย|help|ช่วย|วิธีใช้|ใช้ยังไง/i.test(msg)) {
    return { type: "columns", filters: {}, searchText: "", originalMsg: msg };
  }

  // 1. Plate number or chassis lookup
  const plateMatch = msg.match(/(?:ทะเบียน|plate|เลขทะเบียน)[\s:]*([^\s,]+)/i);
  const chassisMatch = msg.match(/(?:chassis|vin|ตัวถัง|เลขตัวถัง|เลขchassis)[\s:]*([A-Za-z0-9]+)/i);
  if (plateMatch) return { type: "detail", filters: { plate_number: plateMatch[1].trim() }, searchText: "", originalMsg: msg };
  if (chassisMatch) return { type: "detail", filters: { chassis_number: chassisMatch[1].trim() }, searchText: "", originalMsg: msg };
  // Direct code (plate or chassis) — only if entire message is a code
  const directCode = msg.trim().match(/^([A-Za-z0-9ก-ฮ]{2,}[-\s]?[A-Za-z0-9ก-ฮ]{0,6})$/);
  if (directCode && /[0-9]/.test(directCode[1]) && directCode[1].length >= 4 && !BRAND_MAP[lower]) {
    return { type: "detail", filters: {}, searchText: directCode[1].trim(), originalMsg: msg };
  }

  // 2. Summary
  if (/สรุป|ภาพรวม|summary|overview|dashboard/i.test(msg) && !/หา|ค้น|ดู.*คัน/i.test(msg)) {
    return { type: "summary", filters: {}, searchText: "", originalMsg: msg };
  }

  // 3. Analysis
  if (/ขายดี|ซื้อเยอะ|เปรียบเทียบ|compare|วิเคราะห์|analysis|ยอดขาย|กำไร|profit|ประเทศไหน|ยี่ห้อไหน|เดือนนี้|เดือนก่อน|top|อันดับ|สถิติ|stat/i.test(msg)) {
    const brand = matchAlias(msg, BRAND_MAP);
    if (brand) filters.brand = brand;
    return { type: "analysis", filters, searchText: "", originalMsg: msg };
  }

  // 4. Count detection
  const isCount = /กี่คัน|จำนวน|นับ|เท่าไ|how many|count|มีกี่|เรามี/i.test(msg);

  // 5. Extract all filters
  const brand = matchAlias(msg, BRAND_MAP);
  if (brand) filters.brand = brand;
  const drive = matchAlias(msg, DRIVE_MAP);
  if (drive) filters.drive_type = drive;
  const gear = matchAlias(msg, GEAR_MAP);
  if (gear) filters.gear_type = gear;
  const cabin = matchAlias(msg, CABIN_MAP);
  if (cabin) filters.cabin = cabin;
  const color = matchAlias(msg, COLOR_MAP);
  if (color) filters.color = color;
  const status = matchAlias(msg, STATUS_MAP);
  if (status) filters.status = status;

  // Year detection: "ปี 19", "ปี 2019", "year 19", "ปี19"
  const yearMatch = msg.match(/(?:ปี|year|ปีผลิต|ปีรถ)[\s]?(\d{2,4})/i);
  if (yearMatch) {
    let yr = yearMatch[1];
    // Convert 2019 → 19, 2020 → 20 etc.
    if (yr.length === 4) yr = yr.substring(2);
    filters.manufacture = yr;
  }

  // Engine size: "2.4", "2.8", "เครื่อง 2.8"
  const engineMatch = msg.match(/(?:เครื่อง|engine|cc)[\s]?(\d\.\d)/i);
  if (engineMatch) filters.engine_size = engineMatch[1];
  // Also detect standalone engine size in context
  if (!engineMatch) {
    const standaloneEngine = msg.match(/\b(1\.8|2\.0|2\.2|2\.4|2\.5|2\.7|2\.8|3\.0)\b/);
    if (standaloneEngine && Object.keys(filters).length > 0) filters.engine_size = standaloneEngine[1];
  }

  // Country
  const countryMatch = msg.match(/(?:ประเทศ|ส่งไป|country|ปลายทาง|ส่ง)[\s:]*([A-Za-zก-ฮ]+)/i);
  if (countryMatch && countryMatch[1].length > 1) filters.country = countryMatch[1].trim();
  // Buyer
  const buyerMatch = msg.match(/(?:ผู้ซื้อ|ลูกค้า|buyer)[\s:]*([^\s,]+)/i);
  if (buyerMatch) filters.buyer = buyerMatch[1].trim();
  // Agent
  const agentMatch = msg.match(/(?:agent|ตัวแทน|เอเจนท์)[\s:]*([^\s,]+)/i);
  if (agentMatch) filters.agent = agentMatch[1].trim();
  // Port
  const portMatch = msg.match(/(?:ท่าเรือ|port)[\s:]*([^\s,]+)/i);
  if (portMatch) filters.destination_port = portMatch[1].trim();

  // 6. Context from history (if no filters found)
  if (Object.keys(filters).length === 0 && history.length > 0) {
    const recentHistory = history.slice(-4);
    for (const h of [...recentHistory].reverse()) {
      const hLower = h.content.toLowerCase();
      for (const [k, v] of Object.entries(BRAND_MAP)) {
        if (hLower.includes(k) || hLower.includes(v.toLowerCase())) {
          filters.brand = v;
          break;
        }
      }
      if (filters.brand) break;
    }
    // Extract refinement filters from current message
    if (filters.brand) {
      const c = matchAlias(msg, COLOR_MAP); if (c) filters.color = c;
      const d = matchAlias(msg, DRIVE_MAP); if (d) filters.drive_type = d;
      const g = matchAlias(msg, GEAR_MAP); if (g) filters.gear_type = g;
      const cb = matchAlias(msg, CABIN_MAP); if (cb) filters.cabin = cb;
      const st = matchAlias(msg, STATUS_MAP); if (st) filters.status = st;
    }
  }

  if (Object.keys(filters).length > 0) {
    return { type: isCount ? "count" : "search", filters, searchText: "", originalMsg: msg };
  }

  // 7. Check if it's a general question about cars (not just random text)
  if (/รถ|car|vehicle|ยี่ห้อ|brand|ราคา|price|สต็อก|stock|ขาย|sell|ซื้อ|buy|แนะนำ|recommend|ทั้งหมด|all/i.test(msg)) {
    return { type: "summary", filters: {}, searchText: "", originalMsg: msg };
  }

  // 8. Fallback to chat
  return { type: "chat", filters: {}, searchText: msg, originalMsg: msg };
}

// ===== Format Response (when Gemini fails) =====
function formatFallbackResponse(plan: QueryPlan, carData: string): string {
  switch (plan.type) {
    case "columns":
      return "📋 คอลัมน์ข้อมูลสำคัญ:\n\n" +
        "🚗 ข้อมูลรถ:\n" +
        "• spec = สเปครวม\n• brand = ยี่ห้อ\n• model = รุ่น\n• drive_type = ขับเคลื่อน\n• engine_size = เครื่องยนต์\n• gear_type = เกียร์ (AT/MT)\n• cabin = ตัวถัง\n• color = สี\n• manufacture = ปีผลิต\n• mileage = ไมล์\n\n" +
        "📊 สถานะ:\n" +
        "• status = สถานะ (1.Ready=พร้อมขาย, Comming=กำลังมา, Advance=มัดจำ, P.Office=สำนักงาน, 2.Confirm=ยืนยัน, 3.Cancel=ยกเลิก)\n\n" +
        "💰 ราคา:\n" +
        "• buy_price = ราคาซื้อ(บาท)\n• total_cost = ต้นทุนรวม\n• sale_price_usd = ราคาขาย(USD)\n• web_price_usd = ราคาเว็บ(USD)\n\n" +
        "🌍 การขาย:\n" +
        "• buyer = ผู้ซื้อ\n• country = ประเทศปลายทาง\n• destination_port = ท่าเรือ\n• sale_support = ฝ่ายขาย\n\n" +
        "🔑 รหัส:\n" +
        "• plate_number = ทะเบียน\n• chassis_number = เลข VIN";

    case "detail":
      if (carData.includes("ไม่พบ")) return `🔍 ${carData}\n\n💡 ลองพิมพ์เลขทะเบียนหรือ chassis ใหม่อีกครั้ง`;
      return `🚗 รายละเอียดรถ:\n\n${carData}`;

    case "search":
    case "count": {
      if (carData.includes("ไม่พบ")) {
        return `🔍 ${carData}\n\n💡 ลองเปลี่ยนเงื่อนไข เช่น:\n• หารถ REVO\n• มีรถ RANGER กี่คัน\n• รถสีขาว 4WD`;
      }
      // Parse count from carData
      const countMatch = carData.match(/พบ (\d+) คัน/);
      const filterDesc = Object.entries(plan.filters).map(([k, v]) => `${k}=${v}`).join(", ");
      let resp = `📊 ผลการค้นหา (${filterDesc}):\n${carData}`;
      if (countMatch && parseInt(countMatch[1]) > 10) {
        resp += `\n\n💡 มีทั้งหมด ${countMatch[1]} คัน แสดง 10 คันแรก ระบุเงื่อนไขเพิ่มเพื่อกรอง`;
      }
      return resp;
    }

    case "summary":
      return `📊 สรุปข้อมูลรถ:\n\n${carData}`;

    case "analysis":
      return `📈 ข้อมูลวิเคราะห์:\n\n${carData}`;

    default:
      return carData || "🤔 ไม่แน่ใจว่าต้องการอะไร ลองถามใหม่ เช่น:\n• หารถ REVO\n• มีรถ RANGER กี่คัน\n• สรุปรถทั้งหมด";
  }
}

// ===== Main Process =====
async function processMessage(userId: string, userMessage: string): Promise<string> {
  console.log(`[${userId.substring(0, 8)}] Q: "${userMessage}"`);

  const history = await getHistory(userId);
  const plan = planQuery(userMessage, history);
  console.log(`Plan: type=${plan.type} filters=${JSON.stringify(plan.filters)}`);

  let carData = "";

  try {
    switch (plan.type) {
      case "columns": {
        // No data needed, just column descriptions
        carData = "ผู้ใช้ถามเกี่ยวกับคอลัมน์/ความหมายข้อมูล";
        break;
      }
      case "detail": {
        const searchKey = plan.filters.plate_number || plan.filters.chassis_number || plan.searchText;
        const cars = await fetchByPlateOrChassis(searchKey);
        if (cars.length === 0) {
          carData = `ค้นหา "${searchKey}" ไม่พบข้อมูลในฐานข้อมูล`;
        } else {
          carData = `พบ ${cars.length} คัน:\n` + JSON.stringify(cars, null, 1);
        }
        break;
      }
      case "search":
      case "count": {
        const limit = plan.type === "count" ? 1000 : 20;
        const result = await fetchFiltered(plan.filters, limit);
        if (result.count === 0) {
          carData = `ค้นหาด้วยเงื่อนไข ${JSON.stringify(plan.filters)} ไม่พบข้อมูล`;
        } else {
          const statusMap: Record<string, number> = {};
          for (const car of result.data) {
            const s = (car as Record<string, string>).status || "N/A";
            statusMap[s] = (statusMap[s] || 0) + 1;
          }
          carData = `พบ ${result.count} คัน (เงื่อนไข: ${JSON.stringify(plan.filters)})\n`;
          carData += `สถานะ: ${Object.entries(statusMap).map(([s, c]) => `${s}(${c})`).join(", ")}\n`;
          carData += `ตัวอย่าง:\n`;
          for (const c of result.data.slice(0, 10)) {
            const car = c as Record<string, string>;
            carData += `- ${car.spec || car.model_year} | สถานะ:${car.status} | ราคาขาย:${car.sale_price_usd || "-"} | ผู้ซื้อ:${car.buyer || "-"} | ประเทศ:${car.country || "-"}\n`;
          }
        }
        break;
      }
      case "summary": {
        const allCars = await fetchAllForStats();
        const total = allCars.length;
        const agg = (key: string) => {
          const m: Record<string, number> = {};
          for (const d of allCars) { const v = (d as Record<string, string>)[key] || "N/A"; m[v] = (m[v] || 0) + 1; }
          return Object.entries(m).sort((a, b) => b[1] - a[1]);
        };
        carData = `รถทั้งหมด: ${total} คัน\n`;
        carData += `ยี่ห้อ: ${agg("brand").map(([b, c]) => `${b}(${c})`).join(", ")}\n`;
        carData += `สถานะ: ${agg("status").map(([s, c]) => `${s}(${c})`).join(", ")}\n`;
        carData += `ขับเคลื่อน: ${agg("drive_type").map(([d, c]) => `${d}(${c})`).join(", ")}\n`;
        carData += `เกียร์: ${agg("gear_type").map(([g, c]) => `${g}(${c})`).join(", ")}\n`;
        carData += `ตัวถัง: ${agg("cabin").map(([cb, c]) => `${cb}(${c})`).join(", ")}\n`;
        carData += `สี: ${agg("color").map(([co, c]) => `${co}(${c})`).join(", ")}\n`;
        carData += `ประเทศ (top 15): ${agg("country").slice(0, 15).map(([co, c]) => `${co}(${c})`).join(", ")}\n`;
        carData += `ผู้ซื้อ (top 10): ${agg("buyer").slice(0, 10).map(([b, c]) => `${b}(${c})`).join(", ")}`;
        break;
      }
      case "analysis": {
        const allCars = await fetchAllForStats();
        const total = allCars.length;
        const agg = (key: string) => {
          const m: Record<string, number> = {};
          for (const d of allCars) { const v = (d as Record<string, string>)[key] || "N/A"; m[v] = (m[v] || 0) + 1; }
          return Object.entries(m).sort((a, b) => b[1] - a[1]);
        };
        carData = `ข้อมูลสำหรับวิเคราะห์ (${total} คัน):\n`;
        carData += `ยี่ห้อ: ${agg("brand").map(([b, c]) => `${b}(${c})`).join(", ")}\n`;
        carData += `สถานะ: ${agg("status").map(([s, c]) => `${s}(${c})`).join(", ")}\n`;
        carData += `ประเทศ: ${agg("country").slice(0, 20).map(([co, c]) => `${co}(${c})`).join(", ")}\n`;
        carData += `ผู้ซื้อ (top 15): ${agg("buyer").slice(0, 15).map(([b, c]) => `${b}(${c})`).join(", ")}\n`;
        carData += `ฝ่ายขาย: ${agg("sale_support").map(([s, c]) => `${s}(${c})`).join(", ")}\n`;
        carData += `Agent: ${agg("agent").slice(0, 10).map(([a, c]) => `${a}(${c})`).join(", ")}`;
        break;
      }
      case "chat": {
        // General chat — provide summary context
        const { count } = await sb.from("cars").select("id", { count: "exact", head: true });
        carData = `ฐานข้อมูลมีรถทั้งหมด ${count ?? 0} คัน`;
        break;
      }
    }
  } catch (e) {
    console.error("Data fetch err:", e);
    carData = `เกิดข้อผิดพลาดในการดึงข้อมูล: ${String(e)}`;
  }

  console.log(`Data: ${carData.substring(0, 100)}...`);

  // Try Gemini
  const geminiReply = await askGemini(userMessage, history, carData);

  if (geminiReply) {
    await saveHistory(userId, "user", userMessage);
    await saveHistory(userId, "assistant", geminiReply.substring(0, 500));
    return geminiReply;
  }

  // Fallback: format response without Gemini
  console.log("Using fallback formatter");
  const fallback = formatFallbackResponse(plan, carData);
  await saveHistory(userId, "user", userMessage);
  await saveHistory(userId, "assistant", fallback.substring(0, 500));
  return fallback;
}

// ===== Main Handler =====
Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "VIGO4U Secretary Bot v5" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.text();
    const sig = req.headers.get("x-line-signature") || "";
    await verifySig(body, sig);

    const payload = JSON.parse(body);
    const events = payload.events || [];

    for (const event of events) {
      const replyToken = event.replyToken;
      const sourceType = event.source?.type || "user";
      const userId = event.source?.userId || "unknown";

      if (event.type === "message" && event.message?.type === "text") {
        let rawText = event.message.text?.trim() || "";

        // Group/Room: require @VIGO4U mention
        if (sourceType === "group" || sourceType === "room") {
          let mentioned = false;
          for (const m of (event.message.mention?.mentionees || [])) {
            if (m.userId === BOT_USER_ID) { mentioned = true; break; }
          }
          if (!mentioned && /@VIGO4U/i.test(rawText)) mentioned = true;
          if (!mentioned) { console.log("Group no mention, skip"); continue; }
          rawText = rawText.replace(/@VIGO4U\s*/gi, "").trim();
          if (!rawText) rawText = "สรุปรถทั้งหมด";
        }

        const contextId = (sourceType === "group" || sourceType === "room")
          ? `${event.source.groupId || event.source.roomId}_${userId}`
          : userId;

        const response = await processMessage(contextId, rawText);
        await reply(replyToken, response);

      } else if (event.type === "follow") {
        await reply(replyToken,
          "🚗 สวัสดีครับ! ผม VIGO4U เลขาอัจฉริยะสำหรับธุรกิจรถยนต์มือสอง\n\n" +
          "💡 ถามได้ทุกอย่างเกี่ยวกับรถ เช่น:\n" +
          "• หารถ REVO 4WD เกียร์ออโต้\n" +
          "• MG ยี่ห้อ เรามีกี่คัน\n" +
          "• รถปี 19 มีกี่คัน\n" +
          "• สรุปรถทั้งหมด\n" +
          "• เปรียบเทียบ REVO กับ RANGER\n" +
          "• รถทะเบียน 01760\n" +
          "• ขอดูความหมายคอลัมน์\n\n" +
          "📌 ในกลุ่ม: พิมพ์ @VIGO4U นำหน้าคำถาม\n" +
          "💬 ผมจำบทสนทนาได้ ถามต่อเนื่องได้เลยครับ!"
        );
      } else if (event.type === "join") {
        await reply(replyToken,
          "🚗 สวัสดีครับ! ผม VIGO4U เลขาอัจฉริยะข้อมูลรถยนต์มือสอง\n\n" +
          "📌 วิธีใช้ในกลุ่ม: พิมพ์ @VIGO4U ตามด้วยคำถาม เช่น\n" +
          "• @VIGO4U หารถ REVO\n• @VIGO4U สรุปรถทั้งหมด\n• @VIGO4U ยี่ห้อไหนขายดี\n\n" +
          "พร้อมให้บริการแล้วครับ! 😊"
        );
      }
    }

    return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Handler err:", e);
    return new Response(JSON.stringify({ status: "error", message: String(e) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
});

