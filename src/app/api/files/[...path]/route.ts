import { getR2 } from "../../../../../db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const pathname = new URL(request.url).pathname;
  const encoded = pathname.startsWith("/api/files/") ? pathname.slice("/api/files/".length) : "";
  let key = "";
  try { key = encoded.split("/").map(decodeURIComponent).join("/"); } catch { return new Response("Invalid path", { status: 400 }); }
  if (!key || key.includes("..")) return new Response("Invalid path", { status: 400 });
  const object = await getR2().get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", headers.get("cache-control") ?? "public, max-age=3600");
  return new Response(object.body as ReadableStream, { headers });
}
