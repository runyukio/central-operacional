import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = JSON.parse(await readFile(join(process.cwd(), "public/realtime-hours-v2/extension-release.json"), "utf8")) as { extensionId: string; version: string; updateUrl: string };
  if (!/^[a-p]{32}$/.test(release.extensionId) || !/^\d+(\.\d+){1,3}$/.test(release.version)) {
    return new Response("Extension unavailable", { status: 503 });
  }
  const origin = new URL(release.updateUrl).origin;
  const content = `<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${release.extensionId}"><updatecheck codebase="${origin}/realtime-hours-v2/extension.crx" version="${release.version}" /></app></gupdate>`;
  return new Response(content, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
