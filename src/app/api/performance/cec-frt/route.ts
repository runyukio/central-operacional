import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { getCecFrtDashboard } from "@/lib/cec-frt-service";
import { PerformanceError } from "@/lib/performance-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await getApiActor(), query = new URL(request.url).searchParams;
    const data = await getCecFrtDashboard(actor, query);
    if (query.get("export") === "xlsx") {
      const result = buildXlsxResponse({ fileName: `cec_sla_frt_${data.period.startDate}_${data.period.endDate}.xlsx`, sheetName: "Resumo",
        headers: ["Campo", "Valor"], rows: [["Início",data.period.startDate],["Fim",data.period.endDate],["Visão",data.view],
          ["Normal SLA (%)",data.summary.normalSla],["Normal >1440",data.summary.normalOver],["Normal total >0",data.summary.normalTotal],
          ["P0 + HM SLA (%)",data.summary.urgentSla],["P0 + HM >240",data.summary.urgentOver],["P0 + HM total >0",data.summary.urgentTotal],
          ["Output (base CPD)",data.output],["CPD (tickets/dia-parceiro produtivo)",data.cpd],
          ["Data SLA", "Criação do ticket; não é data do atendimento"],["Data CPD", "perform_time da base CPD; não usa denominador FRT"],
          ["Normal", "1 - soma >1440 / soma >0"],["P0 + HM", "1 - soma >240 / soma >0"],
          ["Atualização SLA",data.lastImport?.importedAt ?? null]],
        sheets: [
          { sheetName: "Períodos", headers: ["Período","Normal SLA (%)","Normal >1440","Normal total >0","P0 + HM SLA (%)","P0 + HM >240","P0 + HM total >0","Output","CPD"],
            rows: data.trend.map((r) => [r.period,r.normalSla,r.normalOver,r.normalTotal,r.urgentSla,r.urgentOver,r.urgentTotal,r.output,r.cpd]) },
          { sheetName: "Parceiros", headers: ["WB","Parceiro","Supervisor atual","Skill","Vinculado","Normal SLA (%)","Normal >1440","Normal total >0","P0 + HM SLA (%)","P0 + HM >240","P0 + HM total >0","Output","CPD"],
            rows: data.agents.map((r) => [r.wbLogin,r.name,r.supervisor,r.skill,r.linked,r.normalSla,r.normalOver,r.normalTotal,r.urgentSla,r.urgentOver,r.urgentTotal,r.output,r.cpd]) },
          { sheetName: "Supervisores", headers: ["Supervisor atual","Normal SLA (%)","Normal >1440","Normal total >0","P0 + HM SLA (%)","P0 + HM >240","P0 + HM total >0"],
            rows: data.supervisors.map((r) => [r.name,r.normalSla,r.normalOver,r.normalTotal,r.urgentSla,r.urgentOver,r.urgentTotal]) }
        ] });
      result.headers.set("Cache-Control", "private, no-store"); return result;
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PerformanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[performance/cec-frt]", error);
    return NextResponse.json({ error: "Não foi possível carregar SLA/FRT CEC. Tente novamente ou contate WFM." }, { status: 500 });
  }
}
