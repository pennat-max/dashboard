import { DashboardShellChrome } from "@/components/layout/dashboard-shell-chrome";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/lib/locale-constants";
import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  locale: Locale;
  dict: Dictionary;
};

/** โครงหน้าเต็มจอ — สลับภาษาไทย/อังกฤษมุมขวาบน (ซ่อนบาร์ภาษาเฉพาะมือถือที่ `/m/*`) */
export function DashboardShell({ children, locale, dict }: Props) {
  return (
    <div className={cn("app-shell min-h-screen bg-muted/40")}>
      <DashboardShellChrome locale={locale} dict={dict}>
        {children}
      </DashboardShellChrome>
    </div>
  );
}
