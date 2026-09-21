import React from "react";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ADS_ALERT_RULE, adsAlertPeriodLabel, groupAdsAlertAgents, moderationMinutesLabel,
  type AdsAlertResult, type AlertAgent } from "./ads-productivity-alert-core";

export const ADS_ALERT_IMAGE_WIDTH = 1080;
export const ADS_ALERT_MAX_HEIGHT = 2200;
const BASE_HEIGHT = 400;
const GROUP_HEIGHT = 100;
const ROW_HEIGHT = 88;
const C = { navy: "#0F172A", muted: "#64748B", blue: "#2563EB", border: "#DCE4EF", red: "#B91C1C", amber: "#B45309" };
export type AdsAlertImagePage = { rows: AlertAgent[]; pageNumber: number; pageCount: number; height: number };

export function adsAlertImageHeight(rows: AlertAgent[]) {
  return BASE_HEIGHT + rows.length * ROW_HEIGHT + groupAdsAlertAgents(rows).length * GROUP_HEIGHT;
}

export function paginateAdsAlertImages(result: AdsAlertResult): AdsAlertImagePage[] {
  const chunks: AlertAgent[][] = []; let rows: AlertAgent[] = [];
  for (const row of result.offenders) {
    if (adsAlertImageHeight([...rows, row]) > ADS_ALERT_MAX_HEIGHT && rows.length) { chunks.push(rows); rows = []; }
    rows.push(row);
  }
  if (rows.length) chunks.push(rows);
  return chunks.map((chunk, index) => ({ rows: chunk, pageNumber: index + 1, pageCount: chunks.length, height: adsAlertImageHeight(chunk) }));
}

const clean = (value: string | null, max = 54) => (value ?? "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function renderAdsAlertPng(result: AdsAlertResult, page: AdsAlertImagePage) {
  if (page.height > ADS_ALERT_MAX_HEIGHT || page.height !== adsAlertImageHeight(page.rows)) throw new Error("Invalid ADS alert image size.");
  const fonts = await Promise.all(([400, 700] as const).map(async weight => ({ name: "Inter",
    data: await readFile(join(process.cwd(), "node_modules", "@fontsource", "inter", "files", `inter-latin-${weight}-normal.woff`)), weight, style: "normal" as const })));
  const response = new ImageResponse(<AdsAlertImage result={result} page={page} />, { width: ADS_ALERT_IMAGE_WIDTH, height: page.height, fonts });
  return Buffer.from(await response.arrayBuffer());
}

export function AdsAlertImage({ result, page }: { result: AdsAlertResult; page: AdsAlertImagePage }) {
  return <div style={{ display: "flex", flexDirection: "column", background: "#F4F7FC", color: C.navy, fontFamily: "Inter", padding: "32px", width: "100%", height: "100%" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", color: C.blue, fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>ADS · ALERTA DA HORA</div>
      <div style={{ display: "flex", color: C.muted, fontSize: 18 }}>{`Página ${page.pageNumber}/${page.pageCount}`}</div>
    </div>
    <div style={{ display: "flex", fontSize: 40, fontWeight: 700, marginTop: 12 }}>Produtividade no intervalo</div>
    <div style={{ display: "flex", color: C.muted, fontSize: 21, marginTop: 10 }}>{adsAlertPeriodLabel(result)}</div>
    <div style={{ display: "flex", gap: 16, marginTop: 24, height: 92 }}>
      <div style={{ display: "flex", flex: 1, border: "1px solid #FECACA", borderRadius: 14, background: "#FEF2F2", padding: "16px 20px", flexDirection: "column" }}>
        <div style={{ display: "flex", color: C.red, fontWeight: 700, fontSize: 17 }}>SUBMITS</div>
        <div style={{ display: "flex", fontWeight: 700, fontSize: 28, marginTop: 6 }}>Menos de 35</div>
      </div>
      <div style={{ display: "flex", flex: 1, border: "1px solid #FDE68A", borderRadius: 14, background: "#FFFBEB", padding: "16px 20px", flexDirection: "column" }}>
        <div style={{ display: "flex", color: C.amber, fontWeight: 700, fontSize: 17 }}>MODERATION DURATION</div>
        <div style={{ display: "flex", fontWeight: 700, fontSize: 28, marginTop: 6 }}>Menos de 45 minutos</div>
      </div>
    </div>
    <div style={{ display: "flex", fontSize: 21, fontWeight: 700, marginTop: 19, marginBottom: 16 }}>{`${result.offenders.length} agentes abaixo dos dois limites · zero submit excluído`}</div>
    {groupAdsAlertAgents(page.rows).map(rows => <div key={rows[0].supervisorId ?? "missing"} style={{ display: "flex", flexDirection: "column", background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 54, padding: "0 20px", background: "#EAF1FF" }}>
        <div style={{ display: "flex", fontSize: 23, fontWeight: 700, color: "#1E40AF" }}>{clean(rows[0].supervisorName) || "Sem supervisor cadastrado"}</div>
        <div style={{ display: "flex", fontSize: 18, color: "#1E40AF" }}>{`${rows.length} ${rows.length === 1 ? "agente" : "agentes"}`}</div>
      </div>
      <div style={{ display: "flex", height: 30, padding: "0 20px", alignItems: "center", color: C.muted, fontSize: 15, fontWeight: 700 }}>
        <div style={{ display: "flex", width: "52%" }}>AGENTE / WB</div>
        <div style={{ display: "flex", width: "22%" }}>SUBMITS</div>
        <div style={{ display: "flex", width: "26%" }}>MODERAÇÃO · MIN / SEG</div>
      </div>
      {rows.map((row, index) => <div key={row.employeeId} style={{ display: "flex", height: ROW_HEIGHT, alignItems: "center", padding: "0 20px", background: index % 2 ? "#F8FAFC" : "#FFFFFF", borderTop: "1px solid #EDF1F7" }}>
        <div style={{ display: "flex", flexDirection: "column", width: "52%", paddingRight: 20 }}>
          <div style={{ display: "flex", fontSize: 23, fontWeight: 700, lineHeight: 1.15 }}>{clean(row.name, 52)}</div>
          <div style={{ display: "flex", color: C.muted, fontSize: 17, marginTop: 5 }}>{clean(row.wbLogin, 44)}</div>
        </div>
        <Metric value={String(row.submit)} ratio={row.submit / ADS_ALERT_RULE.submitBelow} color={C.red} background="#FEE2E2" width="22%" />
        <Metric value={moderationMinutesLabel(row.moderationMs)} ratio={row.moderationMs / ADS_ALERT_RULE.moderationBelowMs} color={C.amber} background="#FEF3C7" width="26%" />
      </div>)}
    </div>)}
    <div style={{ display: "flex", flexDirection: "column", color: C.muted, fontSize: 16, marginTop: "auto", lineHeight: 1.5 }}>
      <div style={{ display: "flex" }}>Valores da hora, não acumulados do dia. Barras comparadas aos limites de 35 e 45 min.</div>
      <div style={{ display: "flex" }}>{`Limites fixos, sem ajuste de pausas ou jornada.${result.issues.length ? ` ${result.issues.length} leitura(s) inválida(s) fora da classificação.` : ""}`}</div>
    </div>
  </div>;
}

function Metric({ value, ratio, color, background, width }: { value: string; ratio: number; color: string; background: string; width: string }) {
  return <div style={{ display: "flex", flexDirection: "column", width, paddingRight: 36 }}>
    <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color }}>{value}</div>
    <div style={{ display: "flex", width: "100%", height: 5, background, borderRadius: 8, marginTop: 9 }}>
      <div style={{ display: "flex", width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: 5, background: color, borderRadius: 8 }} />
    </div>
  </div>;
}
