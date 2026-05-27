import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { canAccessAdvanceModule } from "@/lib/permissions";

export async function GET() {
  const actor = await getApiActor();
  if (!canAccessAdvanceModule({ role: actor.role, status: "ACTIVE" })) {
    return NextResponse.json({ error: "Você não tem permissão para baixar template de adiantamento." }, { status: 403 });
  }

  const rows = [
    {
      wb_login: "wb_exemplo01",
      mes_referencia: "2026-06",
      aderente: "Sim",
      observacao: "Opcional"
    }
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ["wb_login", "mes_referencia", "aderente", "observacao"]
  });
  XLSX.utils.book_append_sheet(workbook, sheet, "Adiantamento");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_adiantamento_mensal.xlsx"'
    }
  });
}
