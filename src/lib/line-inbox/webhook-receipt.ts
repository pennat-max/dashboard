import { isLineInboxNoiseOrSeparatorOnlyText } from "@/lib/line-inbox/split-line-text";

export type LineImageSet = {
  id?: string;
  index?: number;
  total?: number;
};

export type NormalizedLineImageSet = {
  id: string;
  index: number;
  total: number;
};

export const LINE_RECEIPT_IMAGE_AFTER_TEXT_WINDOW_MS = 5 * 60 * 1000;

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isLineReceiptCloseMarker(value: unknown): boolean {
  const text = cleanLine(value);
  if (!text) return false;
  if (isLineInboxNoiseOrSeparatorOnlyText(text)) return true;

  const compact = text.replace(/\s+/g, "").toLowerCase();
  return /^(?:จบ|จบงาน|จบคันนี้|ปิด|ปิดงาน|เรียบร้อย|เรียบร้อยแล้ว|คันต่อไป|ต่อไป|ok|okay|done|next)$/.test(compact);
}

export function extractReceiptCardDetails(text: string): {
  plate?: string;
  mileage?: string;
  chassis?: string;
} {
  const raw = cleanLine(text);
  const plate = raw.match(/[0-9]?[ก-ฮ]{1,3}[-\u2013\u2014]\d{2,5}[A-Z]?/u)?.[0]?.replace(/[\u2013\u2014]/g, "-");
  const mileage = raw.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:km|กม\.?|กิโล)/i)?.[1]?.replace(/,/g, "");
  const chassisCandidates = raw.match(/\b[A-HJ-NPR-Z0-9]{12,20}\b/gi) ?? [];
  const chassis = chassisCandidates.find((candidate) => /[A-Z]/i.test(candidate) && /\d/.test(candidate));
  return { plate, mileage, chassis };
}

export function isLineReceiptVehicleText(value: unknown): boolean {
  const text = cleanLine(value);
  if (!text || /^\[LINE (?:image|file)\]/i.test(text)) return false;
  const details = extractReceiptCardDetails(text);
  return Boolean(details.plate || details.chassis);
}

export function normalizeLineImageSet(value: LineImageSet | null | undefined): NormalizedLineImageSet | null {
  const id = cleanLine(value?.id);
  const index = Number(value?.index);
  const total = Number(value?.total);
  if (!id || !Number.isInteger(index) || !Number.isInteger(total)) return null;
  if (index < 1 || total < 1 || index > total) return null;
  return { id, index, total };
}

function imageSetFromAnalyzePayload(value: unknown): NormalizedLineImageSet | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const imageSet = (value as Record<string, unknown>).line_image_set;
  if (!imageSet || typeof imageSet !== "object" || Array.isArray(imageSet)) return null;
  return normalizeLineImageSet(imageSet as LineImageSet);
}

/**
 * LINE explicitly does not guarantee webhook delivery order for simultaneous
 * images. Completion therefore comes from observed set indexes, not from the
 * index on whichever webhook happened to arrive last.
 */
export function isLineImageSetComplete(
  currentImageSet: LineImageSet | null | undefined,
  analyzePayloads: unknown[]
): boolean {
  const current = normalizeLineImageSet(currentImageSet);
  if (!current || current.total <= 1) return true;

  const observedIndexes = new Set<number>();
  for (const payload of analyzePayloads) {
    const candidate = imageSetFromAnalyzePayload(payload);
    if (!candidate || candidate.id !== current.id || candidate.total !== current.total) continue;
    observedIndexes.add(candidate.index);
  }
  return observedIndexes.size >= current.total;
}

/**
 * A receipt is intentionally tied to a photo, never the preceding text.
 * Multi-photo completion is checked separately because LINE webhook order is
 * undefined and an image whose index equals total may arrive first.
 */
export function shouldAttemptLineReceiptReply(input: {
  messageType: "text" | "image" | "file" | "sticker";
  imageSet?: LineImageSet | null;
  rawText?: string | null;
}): boolean {
  if (input.messageType === "sticker") return true;
  if (input.messageType !== "text") return false;
  return isLineReceiptCloseMarker(input.rawText);
}
