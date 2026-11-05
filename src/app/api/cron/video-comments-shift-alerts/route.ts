import {videoCommentsOperationalCronResponse} from "@/lib/video-comments-operational-alerts-service";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
export async function GET(request:Request){return videoCommentsOperationalCronResponse(request,"shift");}
