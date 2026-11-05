import {adsAlertPlans,adsPreviewDispatchTime,type AdsAlertChannel,type AdsAlertPlan,type AdsOperationalReport} from "./ads-operational-alerts-core";
import {validateAdsAlertWebhook} from "./ads-productivity-alert-core";
import {deliverOperationalReport,operationalCronAuthorized} from "./ads-operational-alerts-service";
import {VIDEO_COMMENTS_ALERT_LOBS,videoCommentsPendingReport,type VideoCommentsAlertLob} from "./video-comments-operational-alerts-core";
import {createVideoCommentsDataContext,readVideoCommentsOperationalReport} from "./video-comments-operational-alerts-data";

export async function runVideoCommentsOperationalAlerts(channel:AdsAlertChannel,options:{now?:Date;dryRun?:boolean}={},dependencies:{
  read?:(lob:VideoCommentsAlertLob,plan:AdsAlertPlan,now:Date)=>Promise<AdsOperationalReport>;
  deliver?:typeof deliverOperationalReport;
  environment?:{enabled:string|undefined;vercel:string|undefined;webhook:string|undefined};
}={}){
  const now=options.now??new Date(),dryRun=options.dryRun??false;
  const env=dependencies.environment??{enabled:process.env.VIDEO_COMMENTS_OPERATIONAL_ALERTS_ENABLED,vercel:process.env.VERCEL_ENV,webhook:process.env.VIDEO_COMMENTS_OPERATIONAL_ALERTS_WEBHOOK_URL};
  if(!dryRun&&(env.enabled?.trim().toLowerCase()!=="true"||env.vercel!=="production"))return {status:"skipped",reason:"disabled_or_non_production",reports:[]};
  if(!dryRun)validateAdsAlertWebhook(env.webhook??"");
  const plans=adsAlertPlans(dryRun?adsPreviewDispatchTime(now,channel):now,channel);
  if(!plans.length)return {status:"skipped",reason:"outside_dispatch_window",reports:[]};
  const context=createVideoCommentsDataContext(),results:Array<{lob:VideoCommentsAlertLob;kind:string;periodKey:string;status:string;sent?:number;pending?:boolean;report?:AdsOperationalReport}>=[];
  for(const lob of VIDEO_COMMENTS_ALERT_LOBS)for(const source of plans){
    const plan={...source,periodKey:`${lob.toLowerCase()}:${source.periodKey}`};let report:AdsOperationalReport;
    try{report=await(dependencies.read??((l,p,n)=>readVideoCommentsOperationalReport(l,p,n,context)))(lob,plan,now);}
    catch{report=videoCommentsPendingReport(lob,plan,"Fonte temporariamente indisponível; conferir a consolidação.");}
    // The fixed loop owns LOB and receipt scope, even if a reader fails or returns stale metadata.
    report={...report,lob,kind:plan.kind,periodKey:plan.periodKey};
    if(dryRun){results.push({lob,kind:plan.kind,periodKey:plan.periodKey,status:"preview",pending:report.pending,report});continue;}
    try{const delivery=await(dependencies.deliver??deliverOperationalReport)(report,env.webhook??"");results.push({lob,kind:plan.kind,periodKey:plan.periodKey,pending:report.pending,...delivery});}
    catch{results.push({lob,kind:plan.kind,periodKey:plan.periodKey,status:"failed"});}
  }
  return {status:dryRun?"preview":results.some(r=>r.status==="failed")?"partial_failure":"processed",reports:results};
}
export function videoCommentsCronRequestMode(request:Request,cronSecret:string|undefined,verifySecret:string|undefined){
  const preview=new URL(request.url).searchParams.get("dryRun")==="true";
  if(operationalCronAuthorized(request,cronSecret))return preview?"preview":"run";
  // A separate verification credential can read the latest scheduled preview only.
  // It never grants sending, arbitrary dates, destinations or receipt mutations.
  return preview&&operationalCronAuthorized(request,verifySecret)?"preview":null;
}
export async function videoCommentsOperationalCronResponse(request:Request,channel:AdsAlertChannel){
  const secret=process.env.CRON_SECRET;
  if(!secret?.trim())return Response.json({success:false,error:"Cron is not configured."},{status:503,headers:{"Cache-Control":"no-store"}});
  const mode=videoCommentsCronRequestMode(request,secret,process.env.VIDEO_COMMENTS_OPERATIONAL_ALERTS_VERIFY_SECRET);
  if(!mode)return Response.json({success:false,error:"Unauthorized."},{status:401,headers:{"Cache-Control":"no-store"}});
  try{
    const dryRun=mode==="preview";
    const result=await runVideoCommentsOperationalAlerts(channel,{dryRun});
    if(!dryRun)console.info("[video-comments-operational-alerts]",JSON.stringify({channel,...result}));
    return Response.json({success:result.status!=="partial_failure",...result},{status:result.status==="partial_failure"?502:200,headers:{"Cache-Control":"no-store"}});
  }catch{
    console.error("[video-comments-operational-alerts] Processing failed; check private receipts before retrying.");
    return Response.json({success:false,error:"Unable to process VIDEO/COMMENTS reports."},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
