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

type Body = {
  order_task_id?: string | null;
};

function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
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

  const orderTaskId = String(body.order_task_id ?? "").trim();
  if (!orderTaskId) {
    return NextResponse.json({ error: "order_task_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    let rowsRes = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select("id,label,label_en,note,note_en,outside_note")
      .eq("order_task_id", orderTaskId);

    if (rowsRes.error && isMissingDbColumnError(rowsRes.error.message)) {
      rowsRes = (await supabase
        .from(ORDER_ITEMS_TABLE)
        .select("id,label,label_en,note,note_en")
        .eq("order_task_id", orderTaskId)) as typeof rowsRes;
    }

    if (rowsRes.error) {
      if (isMissingDbColumnError(rowsRes.error.message)) {
        const fallback = await supabase
          .from(ORDER_ITEMS_TABLE)
          .select("id,label,label_en")
          .eq("order_task_id", orderTaskId);
        if (fallback.error) {
          if (isMissingDbColumnError(fallback.error.message)) {
            return NextResponse.json(
              { error: "label_en column not ready. Run latest migration first." },
              { status: 409 }
            );
          }
          throw new Error(fallback.error.message);
        }
        const rows = (fallback.data ?? []) as Array<{
          id?: string | null;
          label?: string | null;
          label_en?: string | null;
        }>;
        const labels = rows.map((r) => String(r.label ?? "").trim()).filter(Boolean);
        const enMap = await buildItemNameEnglishMap(labels);
        if (Object.keys(enMap).length === 0) {
          return NextResponse.json({ ok: true, updated: 0, translatedById: {}, noteTranslatedById: {} });
        }

        const translatedById: Record<string, string> = {};
        const fallbackLabelCache: Record<string, string> = {};
        let updated = 0;
        for (const row of rows) {
          const id = String(row.id ?? "").trim();
          const label = String(row.label ?? "").trim();
          const currentEn = String(row.label_en ?? "").trim();
          let nextEn = String(enMap[orderItemLabelEnglishMapKey(label)] ?? "").trim();
          if (!nextEn && hasThaiScript(label)) {
            if (!(label in fallbackLabelCache)) {
              fallbackLabelCache[label] = String((await translateItemNameToEnglish(label)) ?? "").trim();
            }
            nextEn = String(fallbackLabelCache[label] ?? "").trim();
          }
          if (!id || !label || !nextEn) continue;
          if (currentEn && currentEn.toLowerCase() === nextEn.toLowerCase()) continue;
          const patchRes = await supabase.from(ORDER_ITEMS_TABLE).update({ label_en: nextEn }).eq("id", id);
          if (patchRes.error) {
            if (isMissingDbColumnError(patchRes.error.message)) {
              return NextResponse.json(
                { error: "label_en column not ready. Run latest migration first." },
                { status: 409 }
              );
            }
            throw new Error(patchRes.error.message);
          }
          translatedById[id] = nextEn;
          updated += 1;
        }

        return NextResponse.json({ ok: true, updated, translatedById, noteTranslatedById: {} });
      }
      throw new Error(rowsRes.error.message);
    }

    const rows = (rowsRes.data ?? []) as Array<{
      id?: string | null;
      label?: string | null;
      label_en?: string | null;
      note?: string | null;
      note_en?: string | null;
      outside_note?: string | null;
    }>;

    const needsThaiTranslate = rows.some((r) => {
      const label = String(r.label ?? "").trim();
      const note = String(coalesceOrderItemNote(r.note, r.outside_note) ?? "").trim();
      return (label && hasThaiScript(label)) || (note && hasThaiScript(note));
    });
    if (needsThaiTranslate && !translationApiKeysConfigured()) {
      return NextResponse.json(
        {
          error:
            "แปลไม่ได้: ตั้ง GEMINI_API_KEY หรือ GROQ_API_KEY ใน .env.local (dev) หรือ Vercel → Environment แล้ว restart เซิร์ฟเวอร์ · Translation disabled: add GEMINI_API_KEY or GROQ_API_KEY on the server.",
        },
        { status: 503 }
      );
    }

    const labels = rows.map((r) => String(r.label ?? "").trim()).filter(Boolean);
    const enMap = await buildItemNameEnglishMap(labels);

    const notesForMap = rows
      .map((r) => String(coalesceOrderItemNote(r.note, r.outside_note) ?? "").trim())
      .filter(Boolean);
    const noteEnMap = await buildOrderItemNotesEnglishMap(notesForMap);

    if (Object.keys(enMap).length === 0 && Object.keys(noteEnMap).length === 0) {
      return NextResponse.json({ ok: true, updated: 0, translatedById: {}, noteTranslatedById: {} });
    }

    const translatedById: Record<string, string> = {};
    const noteTranslatedById: Record<string, string> = {};
    const fallbackLabelCache: Record<string, string> = {};
    const fallbackNoteCache: Record<string, string> = {};
    let updated = 0;

    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      const label = String(row.label ?? "").trim();
      const note = String(coalesceOrderItemNote(row.note, row.outside_note) ?? "").trim();
      if (!id) continue;

      const patch: Record<string, unknown> = {};

      let nextLabelEn = label ? String(enMap[orderItemLabelEnglishMapKey(label)] ?? "").trim() : "";
      if (!nextLabelEn && label && hasThaiScript(label)) {
        if (!(label in fallbackLabelCache)) {
          fallbackLabelCache[label] = String((await translateItemNameToEnglish(label)) ?? "").trim();
        }
        nextLabelEn = String(fallbackLabelCache[label] ?? "").trim();
      }
      const currentLabelEn = String(row.label_en ?? "").trim();
      if (nextLabelEn && (!currentLabelEn || currentLabelEn.toLowerCase() !== nextLabelEn.toLowerCase())) {
        patch.label_en = nextLabelEn;
      }

      let nextNoteEn = note ? String(noteEnMap[orderItemNoteEnglishMapKey(note)] ?? "").trim() : "";
      if (!nextNoteEn && note && hasThaiScript(note)) {
        if (!(note in fallbackNoteCache)) {
          fallbackNoteCache[note] = String((await translateOrderItemNoteToEnglish(note)) ?? "").trim();
        }
        nextNoteEn = String(fallbackNoteCache[note] ?? "").trim();
      }
      const currentNoteEn = String(row.note_en ?? "").trim();
      if (nextNoteEn && (!currentNoteEn || currentNoteEn.toLowerCase() !== nextNoteEn.toLowerCase())) {
        patch.note_en = nextNoteEn;
      }

      if (Object.keys(patch).length === 0) continue;

      const patchRes = await supabase.from(ORDER_ITEMS_TABLE).update(patch).eq("id", id);
      if (patchRes.error) {
        if (isMissingDbColumnError(patchRes.error.message)) {
          return NextResponse.json(
            { error: "note_en or label_en column not ready. Run latest migration first." },
            { status: 409 }
          );
        }
        throw new Error(patchRes.error.message);
      }

      updated += 1;
      if (patch.label_en != null) translatedById[id] = String(patch.label_en);
      if (patch.note_en != null) noteTranslatedById[id] = String(patch.note_en);
    }

    return NextResponse.json({ ok: true, updated, translatedById, noteTranslatedById });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
