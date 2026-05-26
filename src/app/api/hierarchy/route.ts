import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus, mapZodError } from "@/lib/api-errors";
import { exportHierarchyCsv, getHierarchy, updateEmployeeManager } from "@/lib/hierarchy-service";

const updateSchema = z.object({
  employeeId: z.string().min(1),
  managerId: z.string().trim().nullable().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const query = {
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    lobId: url.searchParams.get("lobId") ?? undefined,
    lob: url.searchParams.get("lob") ?? undefined,
    supervisorId: url.searchParams.get("supervisorId") ?? undefined,
    managerId: url.searchParams.get("managerId") ?? undefined,
    roleTitle: url.searchParams.get("roleTitle") ?? undefined,
    status: url.searchParams.get("status") ?? undefined
  };

  if (url.searchParams.get("export") === "csv") {
    const result = await exportHierarchyCsv(actor, query);
    if ("error" in result) return errorResponse(result, errorStatus(result));
    return new NextResponse(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  }

  const result = await getHierarchy(actor, query);
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));

  const actor = await getApiActor();
  const result = await updateEmployeeManager(actor, parsed.data);
  if ("error" in result) return errorResponse(result, errorStatus(result));
  return NextResponse.json(result);
}
