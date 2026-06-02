import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { canManageStaffCoverageRequirements } from "@/lib/permissions";

const columns = ["data", "lob", "turno", "requerido", "observacao"];

export async function GET() {
  const actor = await getApiActor();
  if (!canManageStaffCoverageRequirements({ role: actor.role, status: "ACTIVE" })) {
    return NextResponse.json({ error: "Apenas WFM ou ADMIN podem baixar template de requerido.", message: "Apenas WFM ou ADMIN podem baixar template de requerido." }, { status: 403 });
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns,
    ["2026-06-01", "ADS", "Manhã", 20, "Requerido operacional da semana"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "requerido");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_requerido.xlsx"',
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store"
    }
  });
}
