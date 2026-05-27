import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { normalizeRole } from "@/lib/permissions";

export async function GET() {
  const actor = await getApiActor();
  if (!["ADMIN", "GESTOR", "TI"].includes(normalizeRole(actor.role))) {
    return NextResponse.json({ error: "Você não tem permissão para baixar template de equipamentos." }, { status: 403 });
  }

  const headers = [["numero_serie", "responsavel_wb_login", "responsavel_email", "responsavel_nome", "data_entrega", "tipo_equipamento", "modelo", "status", "observacao"]];
  const worksheet = XLSX.utils.aoa_to_sheet(headers);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "equipamentos");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_equipamentos.xlsx"'
    }
  });
}
