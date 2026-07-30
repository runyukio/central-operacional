import { NextResponse } from "next/server";

import {
  getCecResolvedHourlyReport,
  renderCecResolvedKimReport,
  sendCecResolvedReportToKim
} from "@/lib/realtime-cec-kim-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const provided = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  return Boolean(secret) && provided === secret;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const dateKey = url.searchParams.get("date")?.trim() || undefined;
    const report = await getCecResolvedHourlyReport(dateKey);
    const image = renderCecResolvedKimReport(report);
    const sent = await sendCecResolvedReportToKim(image);
    return NextResponse.json({
      success: true,
      sent,
      date: report.dateKey,
      updatedThroughHour: report.updatedThroughHour,
      totalResolved: report.totalResolved,
      imageBytes: image.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The CEC report could not be sent to Kim.";
    console.error("[cron/realtime-cec-kim]", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
