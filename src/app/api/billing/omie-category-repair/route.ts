import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { reconcileBillingOmieAgentCategories } from "@/lib/billing-service";

const REFERENCE_MONTH = "2026-07";

export async function GET() {
  const actor = await getApiActor();
  const result = await reconcileBillingOmieAgentCategories(actor, {
    referenceMonth: REFERENCE_MONTH,
    limit: 5,
    apply: false
  });
  if ("error" in result) return htmlPage(result.error, result.status ?? 400);
  return htmlPage(renderRepairPage(result.data.found, [], null));
}

export async function POST(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== new URL(request.url).origin) {
    return htmlPage("Origem inválida para executar a reconciliação.", 403);
  }
  const actor = await getApiActor();
  const result = await reconcileBillingOmieAgentCategories(actor, {
    referenceMonth: REFERENCE_MONTH,
    limit: 5,
    apply: true
  });
  if ("error" in result) return htmlPage(result.error, result.status ?? 400);
  const failed = result.data.results.filter((item) => item.status !== "SYNCED");
  return htmlPage(renderRepairPage(result.data.remaining, result.data.results, failed.length
    ? `${failed.length} lançamento(s) falharam e permanecem pendentes.`
    : null));
}

function renderRepairPage(
  remaining: number,
  results: Array<{ wbLogin: string; status: string; message: string }>,
  warning: string | null
) {
  const rows = results.map((item) => `<li><strong>${escapeHtml(item.wbLogin)}</strong>: ${escapeHtml(item.status)} — ${escapeHtml(item.message)}</li>`).join("");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Reconciliação Omie</title><style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:0 24px;color:#10203a}button{background:#195ee6;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:700;cursor:pointer}.ok{color:#08783e}.warn{color:#b42318}li{margin:8px 0}</style></head>
<body><h1>Reconciliação de categorias Omie</h1><p>Referência: <strong>${REFERENCE_MONTH}</strong></p>
<p class="${remaining === 0 ? "ok" : "warn"}">Lançamentos ainda identificados com categoria incorreta: <strong>${remaining}</strong></p>
${warning ? `<p class="warn">${escapeHtml(warning)}</p>` : ""}${rows ? `<h2>Último lote</h2><ul>${rows}</ul>` : ""}
${remaining > 0 ? `<form method="post"><button type="submit">Corrigir próximo lote de até 5</button></form>` : `<p class="ok"><strong>Reconciliação concluída.</strong></p>`}
</body></html>`;
}

function htmlPage(body: string, status = 200) {
  return new NextResponse(body.startsWith("<!doctype") ? body : `<p>${escapeHtml(body)}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
