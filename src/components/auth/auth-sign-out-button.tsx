"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";

export function AuthSignOutButton({ email }: { email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const signOut = async () => {
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <div className="flex max-w-[min(100%,14rem)] flex-col items-end gap-1 sm:max-w-none sm:flex-row sm:items-center sm:gap-2">
      <span className="truncate text-right text-xs text-muted-foreground" title={email}>
        {email}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={signOut} disabled={loading}>
        {loading ? "…" : "Sign out"}
      </Button>
    </div>
  );
}
