import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { canImportWorkHours } from "@/lib/permissions";

const columns = [
  "wb_login",
  "data",
  "horas_realizadas",
  "sistema_origem",
  "observacao"
];

export async function GET() {
  const actor = await getApiActor();
  if (!canImportWorkHours({ role: actor.role, status: "ACTIVE" })) {
    return NextResponse.json({ error: "Apenas WFM ou ADMIN podem importar Horas Operacionais." }, { status: 403 });
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns,
    ["WB1001", "2026-06-15", "8:00", "Sistema Ponto", "Exemplo de horas realizadas"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Horas");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_horas_operacionais.xlsx"',
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store"
    }
  });
}
