import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { exportOperationalEmployeesXlsxData } from "@/lib/employee-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const { searchParams } = new URL(request.url);
  const result = await exportOperationalEmployeesXlsxData(actor, {
    query: searchParams.get("q"),
    lob: searchParams.get("lob"),
    status: searchParams.get("status"),
    supervisorId: searchParams.get("supervisorId"),
    shiftId: searchParams.get("shiftId"),
    skill: searchParams.get("skill"),
    wave: searchParams.get("wave")
  });

  if ("error" in result) return errorResponse(result, errorStatus(result));

  return buildXlsxResponse(result);
}
