"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, type Locale } from "@/lib/locale-constants";
import { cn } from "@/lib/utils";

type Props = {
  locale: Locale;
  label: string;
  thLabel: string;
  enLabel: string;
};

export function LocaleSwitcher({ locale, label, thLabel, enLabel }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline">{label}</span>
      <div className="flex rounded-lg border border-border bg-background p-0.5">
        <button
          type="button"
          onClick={() => setLocale("th")}
          disabled={pending}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors",
            locale === "th"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {thLabel}
        </button>
        <button
          type="button"
          onClick={() => setLocale("en")}
          disabled={pending}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors",
            locale === "en"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {enLabel}
        </button>
      </div>
    </div>
  );
}
