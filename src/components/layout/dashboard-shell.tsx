import { DashboardShellChrome } from "@/components/layout/dashboard-shell-chrome";
import type { UserRole } from "@/lib/auth/user-role";
import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  userEmail?: string | null;
  userRole?: UserRole | null;
};

/** App shell (header actions + main). */
export function DashboardShell({ children, userEmail = null, userRole = null }: Props) {
  return (
    <div className={cn("app-shell min-h-screen bg-muted/40")}>
      <DashboardShellChrome userEmail={userEmail} userRole={userRole}>
        {children}
      </DashboardShellChrome>
    </div>
  );
}
