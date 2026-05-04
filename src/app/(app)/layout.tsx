import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getDictionary } from "@/i18n/dictionaries";
import { getLocale } from "@/lib/locale";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return (
    <DashboardShell locale={locale} dict={dict}>
      {children}
    </DashboardShell>
  );
}
