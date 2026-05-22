import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { coalesceOrderItemNote } from "@/lib/data/orders";
import {
  buildItemNameEnglishMap,
  buildOrderItemNotesEnglishMap,
  hasThaiScript,
  orderItemLabelEnglishMapKey,
  orderItemNoteEnglishMapKey,
  translateItemNameToEnglish,
  translateOrderItemNoteToEnglish,
  translationApiKeysConfigured,
} from "@/lib/orders/item-name-translation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const ORDER_ITEMS_TABLE = "order_items";
const MAX_LIMIT = 3000;

type Body = {
  limit?: number;
  force?: boolean;
};

function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
}

type Row = {
  id?: string | null;
  label?: string | null;
  label_en?: string | null;
  note?: string | null;
  outside_note?: string | null;
  note_en?: string | null;
  updated_at?: string | null;
};

function needsLabelPatch(row: Row, force: boolean): boolean {
  const label = String(row.label ?? "").trim();
  if (!label) return false;
  if (force) return true;
  return !String(row.label_en ?? "").trim();
}

function needsNotePatch(row: Row, force: boolean): boolean {
  const note = String(coalesceOrderItemNote(row.note, row.outside_note) ?? "").trim();
  if (!note || !hasThaiScript(note)) return false;
  if (force) return true;
  return !String(row.note_en ?? "").trim();
}

function mergeRowsByUpdatedAt(a: Row[], b: Row[], limit: number): Row[] {
  const byId = new Map<string, Row>();
  for (const r of [...a, ...b]) {
    const id = String(r.id ?? "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, r);
      continue;
    }
    const ta = String(prev.updated_at ?? "");
    const tb = String(r.updated_at ?? "");
    if (tb > ta) byId.set(id, r);
  }
  return Array.from(byId.values())
    .sort((x, y) => String(y.updated_at ?? "").localeCompare(String(x.updated_at ?? "")))
    .slice(0, limit);
}

export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    /* ignore; use defaults */
  }
  const limit = Math.max(1, Math.min(Number(body.limit) || 800, MAX_LIMIT));
  const force = Boolean(body.force);

  try {
    const supabase = createServiceRoleClient();

    const selectFull = "id,label,label_en,note,note_en,outside_note,updated_at";
    const selectFullNoOutside = "id,label,label_en,note,note_en,updated_at";

    let rows: Row[] = [];

    if (force) {
      let full = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select(selectFull)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (full.error && isMissingDbColumnError(full.error.message)) {
        full = (await supabase
          .from(ORDER_ITEMS_TABLE)
          .select(selectFullNoOutside)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(limit)) as typeof full;
      }
      if (full.error) {
        if (isMissingDbColumnError(full.error.message)) {
          const legacy = await supabase
            .from(ORDER_ITEMS_TABLE)
            .select("id,label,label_en,updated_at")
            .order("updated_at", { ascending: false, nullsFirst: false })
            .limit(limit);
          if (legacy.error) throw new Error(legacy.error.message);
          rows = (legacy.data ?? []) as Row[];
        } else {
          throw new Error(full.error.message);
        }
      } else {
        rows = (full.data ?? []) as Row[];
      }
    } else {
      let qLabel = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select(selectFull)
        .or('label_en.is.null,label_en.eq.""')
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (qLabel.error && isMissingDbColumnError(qLabel.error.message)) {
        qLabel = (await supabase
          .from(ORDER_ITEMS_TABLE)
          .select(selectFullNoOutside)
          .or('label_en.is.null,label_en.eq.""')
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(limit)) as typeof qLabel;
      }
      let qNote = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select(selectFull)
        .or('note_en.is.null,note_en.eq.""')
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (qNote.error && isMissingDbColumnError(qNote.error.message)) {
        qNote = (await supabase
          .from(ORDER_ITEMS_TABLE)
          .select(selectFullNoOutside)
          .or('note_en.is.null,note_en.eq.""')
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(limit)) as typeof qNote;
      }

      const labelErr = qLabel.error?.message ?? "";
      const noteErr = qNote.error?.message ?? "";
      if (qLabel.error && isMissingDbColumnError(labelErr)) {
        const legacy = await supabase
          .from(ORDER_ITEMS_TABLE)
          .select("id,label,label_en,updated_at")
          .or('label_en.is.null,label_en.eq.""')
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(limit);
        if (legacy.error) throw new Error(legacy.error.message);
        rows = (legacy.data ?? []) as Row[];
      } else if (qLabel.error) {
        throw new Error(qLabel.error.message);
      } else if (qNote.error && isMissingDbColumnError(noteErr)) {
        rows = mergeRowsByUpdatedAt((qLabel.data ?? []) as Row[], [], limit);
      } else if (qNote.error) {
        throw new Error(qNote.error.message);
      } else {
        rows = mergeRowsByUpdatedAt((qLabel.data ?? []) as Row[], (qNote.data ?? []) as Row[], limit);
      }
    }

    const needRemoteTranslation = rows.some((r) => {
      const label = String(r.label ?? "").trim();
      const note = String(coalesceOrderItemNote(r.note, r.outside_note) ?? "").trim();
      return (label && hasThaiScript(label)) || (note && hasThaiScript(note));
    });
    if (needRemoteTranslation && !translationApiKeysConfigured()) {
      return NextResponse.json(
        {
          error:
            "แปลไม่ได้: ตั้ง GEMINI_API_KEY หรือ GROQ_API_KEY บนเซิร์ฟเวอร์ · Missing GEMINI_API_KEY or GROQ_API_KEY on the server.",
        },
        { status: 503 }
      );
    }

    const labelsNeed = rows.filter((r) => needsLabelPatch(r, force)).map((r) => String(r.label ?? "").trim()).filter(Boolean);
    const notesNeed = rows
      .filter((r) => needsNotePatch(r, force))
      .map((r) => String(coalesceOrderItemNote(r.note, r.outside_note) ?? "").trim())
      .filter(Boolean);

    const enMap = await buildItemNameEnglishMap(Array.from(new Set(labelsNeed)));
    const noteMap = rows.some((r) => String(coalesceOrderItemNote(r.note, r.outside_note) ?? "").trim())
      ? await buildOrderItemNotesEnglishMap(Array.from(new Set(notesNeed)))
      : {};

    let updated = 0;
    let noteColumnMissing = false;
    const fallbackLabelCache: Record<string, string> = {};
    const fallbackNoteCache: Record<string, string> = {};

    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      if (!id) continue;

      const patch: Record<string, unknown> = {};

      if (needsLabelPatch(row, force)) {
        const label = String(row.label ?? "").trim();
        let en = String(enMap[orderItemLabelEnglishMapKey(label)] ?? "").trim();
        if (!en && hasThaiScript(label)) {
          if (!(label in fallbackLabelCache)) {
            fallbackLabelCache[label] = String((await translateItemNameToEnglish(label)) ?? "").trim();
          }
          en = String(fallbackLabelCache[label] ?? "").trim();
        }
        if (en) {
          const cur = String(row.label_en ?? "").trim();
          if (force || !cur || cur.toLowerCase() !== en.toLowerCase()) {
            patch.label_en = en;
          }
        }
      }

      if (needsNotePatch(row, force) && !noteColumnMissing) {
        const note = String(coalesceOrderItemNote(row.note, row.outside_note) ?? "").trim();
        let ne = String(noteMap[orderItemNoteEnglishMapKey(note)] ?? "").trim();
        if (!ne && hasThaiScript(note)) {
          if (!(note in fallbackNoteCache)) {
            fallbackNoteCache[note] = String((await translateOrderItemNoteToEnglish(note)) ?? "").trim();
          }
          ne = String(fallbackNoteCache[note] ?? "").trim();
        }
        if (ne) {
          const cur = String(row.note_en ?? "").trim();
          if (force || !cur || cur.toLowerCase() !== ne.toLowerCase()) {
            patch.note_en = ne;
          }
        }
      }

      if (Object.keys(patch).length === 0) continue;

      const save = await supabase.from(ORDER_ITEMS_TABLE).update(patch).eq("id", id);
      if (save.error) {
        if (isMissingDbColumnError(save.error.message) && patch.note_en != null) {
          noteColumnMissing = true;
          delete patch.note_en;
          if (Object.keys(patch).length === 0) continue;
          const retry = await supabase.from(ORDER_ITEMS_TABLE).update(patch).eq("id", id);
          if (retry.error) {
            if (isMissingDbColumnError(retry.error.message)) {
              return NextResponse.json(
                { error: "label_en column not ready. Run latest migration first." },
                { status: 409 }
              );
            }
            throw new Error(retry.error.message);
          }
          updated += 1;
          continue;
        }
        if (isMissingDbColumnError(save.error.message)) {
          return NextResponse.json(
            { error: "label_en / note_en column not ready. Run latest migration first." },
            { status: 409 }
          );
        }
        throw new Error(save.error.message);
      }
      updated += 1;
    }

    return NextResponse.json({
      ok: true,
      scanned: rows.length,
      updated,
      force,
      remainingHint: rows.length >= limit,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
