import type { Metadata } from "next";
import { chatGPTSignInPath } from "@/lib/auth/chatgpt-auth";

export const metadata: Metadata = {
  title: "Sign in / Create account — Export Cars Dashboard",
};

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = params?.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/dashboard";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-center text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground mt-1 text-center text-sm">
          Main KPIs are public — sign in with ChatGPT for staff access.
        </p>
        <a className="mt-6 flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" href={chatGPTSignInPath(next)} target="_top">
          Sign in with ChatGPT
        </a>
        <p className="text-muted-foreground mt-6 text-center text-xs leading-relaxed">
          Access levels are managed by the VIGO4U admin.
        </p>
      </div>
    </div>
  );
}
