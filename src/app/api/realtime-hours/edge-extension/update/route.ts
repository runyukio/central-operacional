import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const extensionId = "blaplnkbihmcjplmgeaendjndidbppfo";
const version = "1.0.0";
const packageUrl = "https://eastriverbrasil.com/api/realtime-hours/edge-extension/package";

export async function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${extensionId}">\n    <updatecheck codebase="${packageUrl}" version="${version}" />\n  </app>\n</gupdate>\n`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
