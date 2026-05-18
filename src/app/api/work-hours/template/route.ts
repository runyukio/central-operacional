import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

const columns = [
  "wb_login",
  "data",
  "entrada_real",
  "saida_real",
  "pausa_minutos",
  "horas_realizadas",
  "sistema_origem",
  "observacao",
  "nome",
  "email",
  "lob",
  "supervisor_wb_login",
  "turno"
];

export async function GET() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns,
    ["WB1001", "2026-05-15", "06:00", "15:00", "60", "8", "Sistema Ponto", "Exemplo de apontamento real", "Nome do colaborador", "colaborador@empresa.com", "ALL", "SUP001", "Manhã"]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Horas");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template_horas_operacionais.xlsx"'
    }
  });
}
