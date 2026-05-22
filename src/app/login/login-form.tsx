"use client";

import { useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => {
    const n = searchParams.get("next");
    return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
  }, [searchParams]);
  const urlError = searchParams.get("error");
  const decodedUrlError = useMemo(() => {
    if (!urlError) return null;
    try {
      return decodeURIComponent(urlError);
    } catch {
      return urlError;
    }
  }, [urlError]);

  const [mode, setMode] = useState<"signin" | "signup">(() =>
    searchParams.get("mode") === "signup" ? "signup" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(decodedUrlError);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSuccess(null);
    if (mode === "signup" && password !== password2) {
      setMessage("Passwords do not match");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setMessage("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          setMessage(error.message);
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      if (data.session) {
        router.replace(next);
        router.refresh();
        return;
      }
      setSuccess("Confirmation email sent — open the link in your email to activate, then sign in here.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setMessage(null);
            setSuccess(null);
          }}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium transition-colors",
            mode === "signin" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setMessage(null);
            setSuccess(null);
          }}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium transition-colors",
            mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Create account
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="login-email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="login-password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10"
          />
        </div>
        {mode === "signup" ? (
          <div className="space-y-2">
            <label htmlFor="login-password2" className="text-sm font-medium text-foreground">
              Confirm password
            </label>
            <Input
              id="login-password2"
              name="password2"
              type="password"
              autoComplete="new-password"
              required
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className="h-10"
            />
          </div>
        ) : null}
        {message ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            {success}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <LoginFormInner />
    </Suspense>
  );
}
