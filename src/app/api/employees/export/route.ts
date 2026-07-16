import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { exportOperationalEmployeesXlsxData } from "@/lib/employee-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const { searchParams } = new URL(request.url);
  const result = await exportOperationalEmployeesXlsxData(actor, {
    query: searchParams.get("q"),
    lob: searchParams.getAll("lob"),
    status: searchParams.getAll("status_colaborador").length
      ? searchParams.getAll("status_colaborador")
      : searchParams.getAll("employeeStatus").length
        ? searchParams.getAll("employeeStatus")
        : searchParams.getAll("status"),
    supervisorId: searchParams.getAll("supervisorId"),
    shiftId: searchParams.getAll("shiftId"),
    contractType: searchParams.getAll("contractType"),
    roleTitle: searchParams.getAll("roleTitle"),
    skill: searchParams.getAll("skill"),
    wave: searchParams.getAll("wave")
  });

  if ("error" in result) return errorResponse(result, errorStatus(result));

  return buildXlsxResponse(result);
}
