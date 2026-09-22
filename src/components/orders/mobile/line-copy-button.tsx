"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  text: string;
  label: string;
  copiedLabel: string;
  className?: string;
};

export function LineCopyButton({ text, label, copiedLabel, className }: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt("Copy message", text);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={onCopy} className={className}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
