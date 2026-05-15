import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { exportOperationalEmployeesCsv } from "@/lib/employee-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const { searchParams } = new URL(request.url);
  const result = await exportOperationalEmployeesCsv(actor, {
    query: searchParams.get("q"),
    lob: searchParams.get("lob")
  });

  if ("error" in result) return errorResponse(result, errorStatus(result));

  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fileName}"`
    }
  });
}
