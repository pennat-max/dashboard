import type { Locale } from "@/lib/locale-constants";
import en from "@/messages/en.json";
import th from "@/messages/th.json";

export type Dictionary = typeof th;

const dictionaries: Record<Locale, Dictionary> = { th, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries.en;
}
