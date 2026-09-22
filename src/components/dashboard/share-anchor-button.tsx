"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  anchorId: string;
  shareLabel: string;
  copiedLabel: string;
  toneClass?: string;
};

export function ShareAnchorButton({
  anchorId,
  shareLabel,
  copiedLabel,
  toneClass,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}${window.location.pathname}#${anchorId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={onShare}
      className={`h-6 border-foreground/20 bg-transparent text-foreground hover:bg-foreground/10 ${toneClass ?? ""}`}
      title={copied ? copiedLabel : shareLabel}
    >
      {copied ? (
        <>
          <Check className="size-3" aria-hidden />
          {copiedLabel}
        </>
      ) : (
        <>
          <Link2 className="size-3" aria-hidden />
          {shareLabel}
        </>
      )}
    </Button>
  );
}

