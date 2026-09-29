import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

function firstParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
}

export default async function LiffWorkPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams ?? {})) {
    const first = firstParam(value).trim();
    if (first) params.set(key, first);
  }
  if (params.get("focusCarRowId")) {
    params.set("load", "full");
    if (!params.get("scope")) params.set("scope", "active");
  }
  redirect(`/liff/orders${params.size ? `?${params.toString()}` : ""}`);
}
