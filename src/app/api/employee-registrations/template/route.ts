import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { employeeImportColumns } from "@/lib/employee-registration-service";
import { canApproveRegistration } from "@/lib/permissions";

export async function GET() {
  const actor = await getApiActor();
  if (!canApproveRegistration({ role: actor.role, status: "ACTIVE" })) {
    return NextResponse.json({ error: "Supervisor não possui permissão para aprovar ou editar cadastros." }, { status: 403 });
  }

  const sample = Object.fromEntries(employeeImportColumns.map((column) => [column, ""]));
  const worksheet = XLSX.utils.json_to_sheet([sample], { header: [...employeeImportColumns] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "colaboradores");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_colaboradores.xlsx"',
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store"
    }
  });
}
