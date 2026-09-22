import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in / Create account — Export Cars Dashboard",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-center text-xl font-semibold tracking-tight">Sign in / Create account</h1>
        <p className="text-muted-foreground mt-1 text-center text-sm">
          Main KPIs are public — sign in for detail pages and editing.
        </p>
        <div className="mt-6">
          <LoginForm />
        </div>
        <p className="text-muted-foreground mt-6 text-center text-xs leading-relaxed">
          Uses Supabase Auth — create users under Project → Authentication → Users
        </p>
      </div>
    </div>
  );
}
