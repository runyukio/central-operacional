import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

const columns = ["wb_login", "nome", "email", "lob", "supervisor", "data", "turno", "entrada", "saida", "status", "observacao"];

export async function GET() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns,
    ["WB1001", "João Silva", "joao.silva@empresa.com", "CEC", "Carla Supervisora", "2026-05-15", "Manhã", "06:00", "14:00", "Escalado", "Exemplo"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_escala_central_operacional.xlsx"'
    }
  });
}
