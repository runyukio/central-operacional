import { isStorageConfigured, downloadPrivateObject, uploadPrivateObject } from "@/lib/supabase-storage";
import { QualityWeeklyError } from "./access";

export const QUALITY_BUCKET = "quality-weekly-reports";
export function assertQualityStorage() {
  if (!isStorageConfigured() && (process.env.VERCEL === "1" || process.env.NODE_ENV === "production"))
    throw new QualityWeeklyError("Private report storage is not configured. No report was replaced.", 503);
}
export const qualityStorage = {
  async read(path: string) {
    assertQualityStorage();
    return new Uint8Array((await downloadPrivateObject(QUALITY_BUCKET, path)).data);
  },
  async write(path: string, bytes: Uint8Array, type = "application/octet-stream") {
    assertQualityStorage();
    await uploadPrivateObject(QUALITY_BUCKET, path, new File([new Uint8Array(bytes).buffer], "report", { type }));
  },
};
export type QualityStorage = typeof qualityStorage;

export async function signedQualityUpload(path: string, assetId: string) {
  assertQualityStorage();
  if (!isStorageConfigured()) return { url: `/api/quality-weekly/transfers/${assetId}/content`, local: true };
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1`;
  const response = await fetch(`${base}/object/upload/sign/${QUALITY_BUCKET}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "false",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: "{}", cache: "no-store"
  });
  if (!response.ok) throw new QualityWeeklyError("Could not prepare the private upload. Please retry.", 503);
  const data = await response.json() as { url: string };
  return { url: base + data.url, local: false };
}
