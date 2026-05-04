"use client";

import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/lib/locale-constants";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

type Props = {
  children: React.ReactNode;
  locale: Locale;
  dict: Dictionary;
};

/** เส้นทาง `/m/*` — เต็มความกว้าง/ความสูงจอ + safe-area (ทุกรุ่นมือถือ) */
export function DashboardShellChrome({ children, locale, dict }: Props) {
  const pathname = usePathname() ?? "";
  const mobileStandalone = pathname.startsWith("/m");

  return (
    <>
      <div
        className={cn(
          "flex justify-end pt-4",
          mobileStandalone ? "hidden md:flex md:px-8 lg:px-10" : "px-4 md:px-8 lg:px-10"
        )}
      >
        <LocaleSwitcher locale={locale} label={dict.common.language} thLabel={dict.common.thShort} enLabel={dict.common.enShort} />
      </div>
      <main
        data-mobile-fullscreen={mobileStandalone ? "" : undefined}
        className={cn(
          mobileStandalone
            ? "max-md:m-0 max-md:max-w-none max-md:min-h-[100dvh] max-md:min-h-[100svh] max-md:w-full max-md:overflow-x-hidden max-md:p-0 md:px-8 md:py-8 lg:px-10"
            : "px-4 py-6 md:px-8 md:py-8 lg:px-10"
        )}
      >
        {mobileStandalone ? (
          <div className="box-border flex min-h-[100dvh] min-h-[100svh] w-full flex-col bg-slate-100 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] md:min-h-0 md:bg-transparent md:p-0 md:pt-0 md:pb-0 md:pl-0 md:pr-0">
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
