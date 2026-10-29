import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { kimAcceptedMessageKey, validateAdsAlertWebhook } from "./ads-productivity-alert-core";
import { uploadAdsAlertImage } from "./ads-productivity-alert-kim";
import { adsAlertPlans, adsPendingReport, adsPreviewDispatchTime, type AdsAlertChannel, type AdsAlertPlan, type AdsOperationalReport } from "./ads-operational-alerts-core";
import { createOperationalDataContext, readOperationalReport } from "./ads-operational-alerts-data";
import { operationalReportPages, renderOperationalReportPng } from "./ads-operational-alerts-image";

export type AdsOperationalDeliveryStore = {
  claim(key: string, digest: string): Promise<boolean>;
  finish(key: string, status: "sent" | "uncertain", messageKeys: string[]): Promise<void>;
};
const store: AdsOperationalDeliveryStore = {
  async claim(key,digest) {
    try {
      await prisma.systemConfig.create({ data: { key, description: "ADS operational report delivery receipt (private)",
        value: { status: "claimed", digest, claimedAt: new Date().toISOString() } } });
      return true;
    } catch(error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  },
  async finish(key,status,messageKeys) { await prisma.systemConfig.update({ where: { key }, data: { value: { status,messageKeys,finishedAt: new Date().toISOString() } } }); }
};
export async function deliverOperationalReport(report: AdsOperationalReport, webhookValue: string, dependencies: {
  store?: AdsOperationalDeliveryStore; fetcher?: typeof fetch;
  prepare?: (report: AdsOperationalReport, webhook: string) => Promise<string[]>;
} = {}) {
  const webhook=validateAdsAlertWebhook(webhookValue), receipt=dependencies.store??store;
  const deliveryKey=`ads-operational-alert:v1:${report.periodKey}`;
  const digest=createHash("sha256").update(JSON.stringify(report)).digest("hex");
  if (!await receipt.claim(deliveryKey,digest)) return { status: "already_claimed" as const, sent: 0 };
  const messageKeys: string[]=[];
  try {
    const prepare=dependencies.prepare??(async (input,url) => {
      const mediaIds: string[]=[];
      for (const page of operationalReportPages(input)) mediaIds.push(await uploadAdsAlertImage(await renderOperationalReportPng(input,page),url,page.page));
      return mediaIds;
    });
    // Finish all image uploads before sending this report's first page.
    const mediaIds=await prepare(report,webhook);
    if (!mediaIds.length || mediaIds.some(id=>!/^ks:\/\/[^\s<>"']{1,1000}$/.test(id))) throw new Error("Invalid operational image preparation.");
    for (const mediaId of mediaIds) {
      const response=await (dependencies.fetcher??fetch)(webhook,{ method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msgtype: "image", image: { media_id: mediaId } }) });
      const payload: unknown=await response.json();
      const messageKey=response.ok?kimAcceptedMessageKey(payload):null;
      if (!messageKey) throw new Error("KIM did not confirm the report.");
      messageKeys.push(messageKey);
      await receipt.finish(deliveryKey,"uncertain",messageKeys);
    }
    await receipt.finish(deliveryKey,"sent",messageKeys);
    return { status: "sent" as const, sent: messageKeys.length };
  } catch {
    // KIM has no documented idempotent delivery: an unknown result must never be automatically repeated.
    await receipt.finish(deliveryKey,"uncertain",messageKeys).catch(()=>undefined);
    throw new Error("Operational delivery is uncertain; reconcile its private receipt before retrying.");
  }
}
export function operationalCronAuthorized(request: Request, secret: string | undefined) {
  const configured=secret?.trim();
  if (!configured) return false;
  const actual=Buffer.from(request.headers.get("authorization")??""), expected=Buffer.from(`Bearer ${configured}`);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export async function runOperationalAlerts(channel: AdsAlertChannel, options: { now?: Date; dryRun?: boolean } = {}, dependencies: {
  read?: (plan: AdsAlertPlan, now: Date) => Promise<AdsOperationalReport>;
  deliver?: typeof deliverOperationalReport;
  environment?: { enabled: string | undefined; vercel: string | undefined; webhook: string | undefined };
} = {}) {
  const now=options.now??new Date(), dryRun=options.dryRun??false;
  const env=dependencies.environment??{ enabled: process.env.ADS_OPERATIONAL_ALERTS_ENABLED, vercel: process.env.VERCEL_ENV, webhook: process.env.ADS_OPERATIONAL_ALERTS_WEBHOOK_URL };
  if (!dryRun && (env.enabled?.trim().toLowerCase()!=="true" || env.vercel!=="production")) return { status: "skipped", reason: "disabled_or_non_production", reports: [] };
  if (!dryRun) validateAdsAlertWebhook(env.webhook??"");
  const plans=adsAlertPlans(dryRun?adsPreviewDispatchTime(now,channel):now,channel);
  if (!plans.length) return { status: "skipped", reason: "outside_dispatch_window", reports: [] };
  const context=createOperationalDataContext();
  const results: Array<{ kind: string; periodKey: string; status: string; sent?: number; pending?: boolean; report?: AdsOperationalReport }>=[];
  for (const plan of plans) {
    let report: AdsOperationalReport;
    try { report=await (dependencies.read??((p,n)=>readOperationalReport(p,n,context)))(plan,now); }
    catch { report=adsPendingReport(plan,"Fonte temporariamente indisponível; conferir a consolidação."); }
    if (dryRun) { results.push({ kind:plan.kind,periodKey:plan.periodKey,status:"preview",pending:report.pending,report }); continue; }
    try {
      const delivery=await (dependencies.deliver??deliverOperationalReport)(report,env.webhook??"");
      results.push({ kind:plan.kind,periodKey:plan.periodKey,pending:report.pending,...delivery });
    } catch { results.push({ kind:plan.kind,periodKey:plan.periodKey,status:"failed" }); }
  }
  return { status: dryRun?"preview":results.some(r=>r.status==="failed")?"partial_failure":"processed", reports:results };
}
export async function operationalCronResponse(request: Request, channel: AdsAlertChannel) {
  const secret=process.env.CRON_SECRET;
  if (!secret?.trim()) return Response.json({ success:false,error:"Cron is not configured." },{ status:503,headers:{ "Cache-Control":"no-store" } });
  if (!operationalCronAuthorized(request,secret)) return Response.json({ success:false,error:"Unauthorized." },{ status:401,headers:{ "Cache-Control":"no-store" } });
  try {
    const dryRun=new URL(request.url).searchParams.get("dryRun")==="true";
    const result=await runOperationalAlerts(channel,{ dryRun });
    if (!dryRun) console.info("[ads-operational-alerts]",JSON.stringify({ channel,...result }));
    return Response.json({ success:result.status!=="partial_failure",...result },{ status:result.status==="partial_failure"?502:200,headers:{ "Cache-Control":"no-store" } });
  } catch {
    console.error("[ads-operational-alerts] Processing failed; check private receipts before retrying.");
    return Response.json({ success:false,error:"Unable to process ADS operational reports." },{ status:502,headers:{ "Cache-Control":"no-store" } });
  }
}
