import React from "react";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdsAlertGroup, AdsOperationalReport, AdsAlertCell } from "./ads-operational-alerts-core";

const COLORS = { text: "#1C2538", muted: "#7183A0", red: "#CF2027", orange: "#BA5300", blue: "#346CFF", green: "#198754" };
export const ADS_OPERATIONAL_IMAGE_WIDTH = 1080;
export const ADS_OPERATIONAL_IMAGE_MAX_HEIGHT = 2200;
const ROW = 88, GROUP = 96;
export type AdsOperationalPage = { groups: AdsAlertGroup[]; page: number; count: number; height: number };
const baseHeight = (report: AdsOperationalReport) => 480 + report.notes.reduce((n, note) => n + Math.ceil(note.length / 110) * 24, 0);
const height = (report: AdsOperationalReport, groups: AdsAlertGroup[]) => baseHeight(report) + groups.reduce((sum, group) => sum + GROUP + group.rows.length * ROW, 0);
export function operationalReportPages(report: AdsOperationalReport): AdsOperationalPage[] {
  const pages: AdsAlertGroup[][] = [];
  let groups: AdsAlertGroup[] = [];
  for (const group of report.groups) {
    if (group.rows.length && height(report,[group]) <= ADS_OPERATIONAL_IMAGE_MAX_HEIGHT) {
      if (groups.length && height(report,[...groups,group]) > ADS_OPERATIONAL_IMAGE_MAX_HEIGHT) { pages.push(groups);groups=[]; }
      groups.push({ ...group,rows:[...group.rows] });
      continue;
    }
    for (const row of group.rows) {
      const candidate = groups.map(g => ({ ...g, rows: [...g.rows] }));
      if (candidate.at(-1)?.title === group.title) candidate[candidate.length - 1].rows.push(row);
      else candidate.push({ title: group.title, rows: [row] });
      if (height(report,candidate) > ADS_OPERATIONAL_IMAGE_MAX_HEIGHT && groups.length) {
        pages.push(groups); groups = [{ title: group.title, rows: [row] }];
      } else groups = candidate;
    }
  }
  if (groups.length) pages.push(groups);
  if (!pages.length) throw new Error("An operational report must contain a result row.");
  return pages.map((items,index) => ({ groups: items, page: index + 1, count: pages.length, height: height(report,items) }));
}
const clean = (value: string, max = 100) => value.replace(/[\r\n\t<>]/g," ").replace(/\s+/g," ").trim().slice(0,max);
export async function renderOperationalReportPng(report: AdsOperationalReport, page: AdsOperationalPage, preview = false) {
  if (page.height > ADS_OPERATIONAL_IMAGE_MAX_HEIGHT || page.height !== height(report,page.groups)) throw new Error("Invalid operational report page.");
  const fonts = await Promise.all(([400,700] as const).map(async weight => ({ name: "Inter", weight, style: "normal" as const,
    data: await readFile(join(process.cwd(),"node_modules","@fontsource","inter","files",`inter-latin-${weight}-normal.woff`)) })));
  const response = new ImageResponse(<OperationalReportImage report={report} page={page} preview={preview} />,
    { width: ADS_OPERATIONAL_IMAGE_WIDTH, height: page.height, fonts });
  return Buffer.from(await response.arrayBuffer());
}
export function OperationalReportImage({ report, page, preview = false }: { report: AdsOperationalReport; page: AdsOperationalPage; preview?: boolean }) {
  const four = report.headings.length === 4;
  const widths = four ? ["48%","17%","18%","17%"] : ["52%","22%","26%"];
  return <div style={{ display:"flex",flexDirection:"column",width:"100%",height:"100%",padding:32,background:"#F4F7FE",fontFamily:"Inter",color:COLORS.text }}>
    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:20 }}>
      <div style={{ display:"flex",fontWeight:700,color:COLORS.blue,letterSpacing:1.5 }}>{preview ? "ADS · TESTE DE VALIDAÇÃO" : "ADS · ALERTA OPERACIONAL"}</div>
      <div style={{ display:"flex",fontSize:17,color:COLORS.muted }}>{`Página ${page.page}/${page.count}`}</div>
    </div>
    <div style={{ display:"flex",fontSize:39,fontWeight:700,marginTop:12 }}>{clean(report.title,80)}</div>
    <div style={{ display:"flex",fontSize:20,color:COLORS.muted,marginTop:10 }}>{clean(report.subtitle,110)}</div>
    <div style={{ display:"flex",gap:16,marginTop:24,height:92 }}>
      {report.metrics.map((metric,index) => <div key={index} style={{ display:"flex",flexDirection:"column",flex:1,border:`1px solid ${report.metrics.length===3&&index!==1?"#D5E2FF":index===0?"#FFD4D7":"#FFE39A"}`,borderRadius:13,background:report.metrics.length===3&&index!==1?"#EAF0FF":index===0?"#FFF2F3":"#FFFBEB",padding:"15px 18px" }}>
        <div style={{ display:"flex",fontSize:16,fontWeight:700,color:report.metrics.length===3&&index!==1?COLORS.blue:index===0?COLORS.red:COLORS.orange }}>{clean(metric.label,42)}</div>
        <div style={{ display:"flex",fontSize:report.metrics.length===3?26:28,fontWeight:700,marginTop:7 }}>{clean(metric.value,46)}</div>
      </div>)}
    </div>
    <div style={{ display:"flex",fontWeight:700,fontSize:20,marginTop:20,marginBottom:16 }}>{clean(report.summary,115)}</div>
    {page.groups.map((group,groupIndex) => <div key={groupIndex} style={{ display:"flex",flexDirection:"column",border:"1px solid #E1E8F5",borderRadius:13,overflow:"hidden",marginBottom:16,background:"white" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",height:50,padding:"0 20px",background:"#EAF0FF",color:"#2B48B8" }}>
        <div style={{ display:"flex",fontSize:22,fontWeight:700 }}>{clean(group.title,72)}</div>
        <div style={{ display:"flex",fontSize:16 }}>{`${group.rows.length} ${report.kind==="required"?"turno":report.kind==="volume"?"referência":report.pending?"registro":"agente"}${group.rows.length===1?"":"s"}`}</div>
      </div>
      <div style={{ display:"flex",height:30,alignItems:"center",padding:"0 20px",fontSize:14,fontWeight:700,color:COLORS.muted }}>
        {report.headings.map((heading,index) => <div key={index} style={{ display:"flex",width:widths[index] }}>{heading}</div>)}
      </div>
      {group.rows.map((row,index) => <div key={index} style={{ display:"flex",alignItems:"center",height:ROW,padding:"0 20px",background:index%2?"#F7F9FC":"white",borderTop:"1px solid #EDF1F7" }}>
        <div style={{ display:"flex",flexDirection:"column",width:widths[0],paddingRight:18 }}>
          <div style={{ display:"flex",fontSize:four?21:22,fontWeight:700,lineHeight:1.15 }}>{clean(row.name,64)}</div>
          <div style={{ display:"flex",fontSize:16,color:COLORS.muted,marginTop:5 }}>{clean(row.detail,74)}</div>
        </div>
        {row.cells.map((value,cellIndex) => <ReportCell key={cellIndex} cell={value} width={widths[cellIndex+1]} compact={four} />)}
      </div>)}
    </div>)}
    <div style={{ display:"flex",flexDirection:"column",marginTop:"auto",fontSize:16,color:COLORS.muted,lineHeight:1.4 }}>
      {report.notes.map((note,index) => <div key={index} style={{ display:"flex",marginTop:4 }}>{clean(note,420)}</div>)}
    </div>
  </div>;
}
function ReportCell({ cell, width, compact }: { cell: AdsAlertCell; width: string; compact: boolean }) {
  const color=COLORS[cell.color??"text"];
  return <div style={{ display:"flex",flexDirection:"column",width,paddingRight:20 }}>
    <div style={{ display:"flex",fontSize:compact?25:28,fontWeight:700,color }}>{clean(cell.value,24)}</div>
    {cell.ratio!==undefined && <div style={{ display:"flex",height:5,background:"#E1E8F5",borderRadius:6,marginTop:9,width:"100%" }}>
      <div style={{ display:"flex",height:5,borderRadius:6,background:color,width:`${Math.max(0,Math.min(1,cell.ratio))*100}%` }} />
    </div>}
  </div>;
}
