import { UserRoleProvider } from "@/components/auth/user-role-provider";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getSessionAndRole } from "@/lib/auth/session-role";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, role } = await getSessionAndRole();
  const userEmail = user?.email ?? null;

  return (
    <UserRoleProvider role={user ? role : null}>
      <DashboardShell userEmail={userEmail} userRole={user ? role : null}>
        {children}
      </DashboardShell>
    </UserRoleProvider>
  );
}
