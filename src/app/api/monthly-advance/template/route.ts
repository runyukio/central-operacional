import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET() {
  const rows = [
    {
      wb_login: "wb_exemplo01",
      mes_referencia: "2026-06",
      aderente: "Sim",
      valor: "300,00",
      observacao: "Opcional"
    }
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ["wb_login", "mes_referencia", "aderente", "valor", "observacao"]
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
