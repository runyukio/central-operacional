import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

const columns = ["wb_login", "data", "status", "turno", "entrada", "saida", "lob"];

export async function GET() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns,
    ["WB1001", "2026-05-15", "Escalado", "Manhã", "06:00", "14:00", "CEC"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_escala_central_operacional.xlsx"',
      "Content-Length": String(body.byteLength),
      "Cache-Control": "no-store"
    }
  });
}
