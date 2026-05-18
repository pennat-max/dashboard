import type { Car } from "@/types/car";

function norm(s: string): string {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

/** บรรทัดที่น่าจะเป็นหัวข้อรถ (ทะเบียน / เลขถัง / spec) */
export function looksLikeVehicleLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/ทะเบียน|เลขทะเบียน|ป้าย|เลขตัวถัง/i.test(t)) return true;
  if (/\bMR0[A-Z0-9]{12,}\b/i.test(t)) return true;
  if (/\d{1,3}[- ]?\d{2,4}/.test(t) && /[A-Za-zก-๙]{2,}/.test(t) && t.length >= 10) return true;
  if (t.length >= 16 && /\d/.test(t) && /(REVO|FORTUNER|RANGER|VIGO|DMAX|COMMUTER|TRAVO|RAPTOR|MAZDA|HIACE|ROCCO)/i.test(t)) return true;
  return false;
}

/** บรรทัดท้ายแชท (@ หลายตัว, ชื่อ ALL CAPS สั้นๆ, ฯลฯ) — หยุดเก็บรายการเมื่อเจอ */
export function isNoiseTailLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const atCount = (t.match(/@/g) || []).length;
  if (atCount >= 2) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => /^@\S/.test(p))) return true;
  if (/^[A-Z]{2,12}$/.test(t) && !/\d/.test(t)) return true;
  return false;
}

export type UrgentPasteResult = {
  vehicleLine: string;
  items: string[];
  skippedBeforeItems: string[];
  skippedAfterItems: string[];
};

/**
 * แยกข้อความ LINE: บรรทัดหัวรถ + รายการนำหน้า `-` / `•` / `・`
 * ตัดท้ายกลุ่ม @ และชื่อสั้น ALL CAPS แบบลงท้ายแชท
 */
export function parseUrgentLinePaste(raw: string): UrgentPasteResult {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const skippedBeforeItems: string[] = [];
  const skippedAfterItems: string[] = [];

  if (lines.length === 0) {
    return { vehicleLine: "", items: [], skippedBeforeItems: [], skippedAfterItems: [] };
  }

  const firstBulletIdx = lines.findIndex((l) => /^\s*[-•・]\s*\S/.test(l));

  if (firstBulletIdx === -1) {
    let vehicleLine = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      if (looksLikeVehicleLine(lines[i])) {
        vehicleLine = lines[i];
        skippedBeforeItems.push(...lines.slice(0, i));
        break;
      }
    }
    if (!vehicleLine) {
      vehicleLine = lines[lines.length - 1];
      skippedBeforeItems.push(...lines.slice(0, -1));
    }
    return { vehicleLine, items: [], skippedBeforeItems, skippedAfterItems };
  }

  const preamble = lines.slice(0, firstBulletIdx);
  let vehicleLine = "";
  for (let i = preamble.length - 1; i >= 0; i--) {
    if (isNoiseTailLine(preamble[i])) continue;
    if (looksLikeVehicleLine(preamble[i])) {
      vehicleLine = preamble[i];
      break;
    }
  }
  if (!vehicleLine) {
    for (let i = preamble.length - 1; i >= 0; i--) {
      if (!isNoiseTailLine(preamble[i])) {
        vehicleLine = preamble[i];
        break;
      }
    }
  }
  const skippedPreamble = preamble.filter((l) => l !== vehicleLine);
  skippedBeforeItems.push(...skippedPreamble);

  const items: string[] = [];
  for (let i = firstBulletIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isNoiseTailLine(line)) {
      skippedAfterItems.push(...lines.slice(i));
      break;
    }
    const bullet = line.match(/^\s*[-•・]\s*(.+)$/);
    if (bullet) {
      items.push(bullet[1].trim());
      continue;
    }
    if (items.length) {
      items[items.length - 1] = `${items[items.length - 1]} ${line}`.trim();
    } else {
      skippedAfterItems.push(line);
    }
  }

  return { vehicleLine, items, skippedBeforeItems, skippedAfterItems };
}

/** สร้างคำค้นสั้นจากบรรทัดรถ — เน้นทะเบียน / เลขถังถ้ามี */
export function suggestSearchQueryFromVehicleLine(vehicleLine: string): string {
  const t = vehicleLine
    .replace(/ทะเบียน|เลขทะเบียน|ป้าย|ข้อความ(?:ที่อ้างถึง)?|ชื่อ\s*line|นี่คือ|ของเช่น/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const plate = t.match(/\d{1,3}[- ]?\d{2,4}/);
  if (plate) return plate[0].replace(/\s/g, "");
  const ch = t.match(/\bMR0[A-Z0-9]{12,}\b/i);
  if (ch) return ch[0];
  return t
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .slice(0, 48);
}

export function carsMatchingQuery(cars: Car[], query: string): Car[] {
  const q = query.trim();
  if (!q) return cars.slice(0, 40);
  const n = norm(q);
  const ql = q.toLowerCase();
  const out = cars.filter((car) => {
    const plate = String(car.plate_number ?? "");
    const chassis = String(car.chassis_number ?? "").trim();
    const spec = String(car.spec ?? car.model ?? car.brand ?? "");
    return (
      plate.includes(q) ||
      norm(plate).includes(n) ||
      chassis.toLowerCase().includes(ql) ||
      norm(chassis).includes(n) ||
      spec.toLowerCase().includes(ql)
    );
  });
  return out.slice(0, 50);
}

export function carLabelForIntake(car: Car): string {
  const bits = [car.brand, car.model, car.model_year, car.spec].map((x) => String(x ?? "").trim()).filter(Boolean);
  if (bits.length) return bits.join(" ").replace(/\s+/g, " ").slice(0, 120);
  return String(car.spec ?? "").trim().slice(0, 120) || "—";
}
