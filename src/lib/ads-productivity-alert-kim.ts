import { buildAdsAlertMentions, buildAdsAlertSummary, validateAdsAlertWebhook,
  type AdsAlertResult, type KimAlertDeliveryPayload } from "./ads-productivity-alert-core";
import { paginateAdsAlertImages, renderAdsAlertPng, type AdsAlertImagePage } from "./ads-productivity-alert-image";

export function kimImageMediaId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.success === false || (record.status !== undefined && record.status !== 200) || (record.code !== undefined && record.code !== 0)) return null;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  if (data.type !== undefined && data.type !== "image") return null;
  return typeof data.media_id === "string" && /^ks:\/\/[^\s<>"']{1,1000}$/.test(data.media_id) ? data.media_id : null;
}

export async function uploadAdsAlertImage(png: Buffer, webhook: string, pageNumber: number, fetcher: typeof fetch = fetch) {
  const url = new URL(validateAdsAlertWebhook(webhook));
  if (png.length > 2 * 1024 * 1024 || png.length < 8 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("ADS alert must be a valid PNG below 2 MB.");
  }
  const form = new FormData();
  form.set("key", url.searchParams.get("key")!);
  form.set("type", "image");
  form.set("media", new Blob([Uint8Array.from(png)], { type: "image/png" }), `ads-alert-${pageNumber}.png`);
  // Direct robot upload: no public bucket, public employee image URL or extra credentials.
  const response = await fetcher("https://kim-robot.kwaitalk.com/api/robot/upload", {
    method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(20_000)
  });
  const payload: unknown = await response.json();
  const mediaId = response.ok ? kimImageMediaId(payload) : null;
  if (!mediaId) throw new Error("KIM did not confirm the ADS image upload.");
  return mediaId;
}

export async function prepareAdsAlertDelivery(result: AdsAlertResult, webhook: string, dependencies: {
  render?: (result: AdsAlertResult, page: AdsAlertImagePage) => Promise<Buffer>;
  upload?: (png: Buffer, webhook: string, pageNumber: number) => Promise<string>;
} = {}): Promise<KimAlertDeliveryPayload[]> {
  if (!result.offenders.length) return [];
  const messages: KimAlertDeliveryPayload[] = [buildAdsAlertSummary(result)];
  for (const page of paginateAdsAlertImages(result)) {
    const png = await (dependencies.render ?? renderAdsAlertPng)(result, page);
    const mediaId = await (dependencies.upload ?? uploadAdsAlertImage)(png, webhook, page.pageNumber);
    messages.push({ msgtype: "image", image: { media_id: mediaId } });
  }
  return [...messages, ...buildAdsAlertMentions(result)];
}
