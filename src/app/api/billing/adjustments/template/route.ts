import { buildXlsxResponse } from "@/lib/xlsx-export";

export async function GET() {
  return buildXlsxResponse({
    fileName: "template_billing_bonus_correcao.xlsx",
    sheetName: "Ajustes",
    headers: ["wb_login", "correcao", "bonus", "motivo"],
    rows: [
      ["wb_exemplo", 100, "", "Motivo da correção"],
      ["wb_exemplo2", "", 250, "Motivo do bônus"]
    ]
  });
}
