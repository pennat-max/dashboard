import Link from "next/link";
import { redirect } from "next/navigation";
import { UsersManagement } from "./users-management";
import { getSessionAndRole } from "@/lib/auth/session-role";
import { canManageUsers } from "@/lib/auth/user-role";

export const dynamic = "force-dynamic";

export default async function DashboardUsersPage() {
  const { user, role } = await getSessionAndRole();
  if (!user || role == null || !canManageUsers(role)) {
    redirect("/dashboard");
  }

  return (
    <div className="dashboard-stack mx-auto flex max-w-5xl flex-col gap-8">
      <header className="border-b border-border pb-6">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Admin</p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">User management</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Users who sign up on their own appear below with role <strong>1</strong>. Change their role and click{" "}
          <strong>Apply</strong>. Requires <code className="rounded bg-muted px-1 py-0.5 text-xs">public.profiles</code>{" "}
          and <code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_SERVICE_ROLE_KEY</code> on the server.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to dashboard
        </Link>
      </header>
      <UsersManagement />
    </div>
  );
}
