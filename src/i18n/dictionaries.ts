import type { Locale } from "@/lib/locale-constants";
import en from "@/messages/en.json";
import th from "@/messages/th.json";

export type Dictionary = typeof en;

export function getDictionary(locale: Locale): Dictionary {
  return locale === "en" ? en : th;
}
