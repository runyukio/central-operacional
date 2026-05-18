import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET() {
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
