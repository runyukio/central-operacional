import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isStorageConfigured } from "@/lib/supabase-storage";
import { QualityWeeklyError } from "./access";
import { createQualityWeeklyService, sha256 } from "./service";
import { qualityStorage, signedQualityUpload } from "./storage";
import { MAX_UPLOAD } from "./workbook";
import { reportFilename } from "./word";
import type { QualityAuthor } from "./service";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders });
const id = z.string().uuid();
const importInput = z.object({ assetId: id, sheet: z.string().max(150).optional(), dateColumn: z.string().max(150).optional() });
const previewInput = z.object({ uploadId: id, start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weekNumber: z.number().int().min(1).max(53), complete: z.boolean() });
const commitInput = z.object({ draftId: id, complete: z.boolean(), replace: z.boolean().default(false) });
const service = createQualityWeeklyService(prisma, qualityStorage);
export function validateQualityOrigin(request: Request) {
  if (request.method === "GET") return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new QualityWeeklyError("Submit changes from the operational site.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new QualityWeeklyError("Cross-site requests are not allowed.", 403);
}
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 20000) throw new QualityWeeklyError("Request is too large.", 413);
  try { return JSON.parse(text); } catch { throw new QualityWeeklyError("Invalid request body."); }
}
function fileResponse(bytes: Uint8Array, filename: string, type: string) {
  return new Response(new Uint8Array(bytes).buffer, { headers: { ...privateHeaders, "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` } });
}
export async function qualityWeeklyHandler(request: Request, author: QualityAuthor) {
  validateQualityOrigin(request);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/quality-weekly\/?/, "").split("/").filter(Boolean);
  const method = request.method;
  if (method === "GET" && path[0] === "status") {
    const mapping = await service.currentMapping();
    return json({ user: author, mapping: mapping ? { id: mapping.id, filename: mapping.asset.filename, entries: mapping.entries, createdAt: mapping.createdAt, createdBy: mapping.createdBy } : null });
  }
  if (method === "GET" && path[0] === "mapping-template") return fileResponse(new TextEncoder().encode("queue_id,queue_name,section,industry,category\r\n"), "Queue mapping template.csv", "text/csv; charset=utf-8");
  if (method === "POST" && path[0] === "transfers" && !path[1]) {
    const input = z.object({ filename: z.string().min(1).max(240), size: z.number().int().positive().max(MAX_UPLOAD), kind: z.enum(["source", "mapping"]) }).parse(await body(request));
    const asset = await service.transfer(input.filename, input.size, input.kind, author);
    return json({ id: asset.id, ...await signedQualityUpload(asset.objectPath, asset.id) });
  }
  if (method === "PUT" && path[0] === "transfers" && path[2] === "content") {
    // Local development only; production uploads go directly to private Storage to avoid the platform body limit.
    if (isStorageConfigured() || process.env.VERCEL === "1" || process.env.NODE_ENV === "production") throw new QualityWeeklyError("Local uploads are disabled.", 404);
    const asset = await prisma.qualityWeeklyAsset.findUnique({ where: { id: id.parse(path[1]) } });
    if (!asset || asset.createdById !== author.id) throw new QualityWeeklyError("Upload not found.", 404);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length !== asset.declaredSize || bytes.length > MAX_UPLOAD) throw new QualityWeeklyError("Upload size mismatch.", 413);
    await qualityStorage.write(asset.objectPath, bytes);
    return json({ uploaded: true });
  }
  if (method === "POST" && path[0] === "inspect") return json(await service.inspect(id.parse((await body(request)).assetId), author));
  if (method === "POST" && (path[0] === "mappings" || (path[0] === "imports" && !path[1]))) {
    const input = importInput.parse(await body(request));
    return json(path[0] === "mappings" ? await service.mapping(input.assetId, author, input.sheet) : await service.importAsset(input.assetId, author, input.sheet, input.dateColumn));
  }
  if (method === "POST" && path[0] === "imports" && path[2] === "revalidate") {
    const input = z.object({ dateColumn: z.string().max(150).optional() }).parse(await body(request));
    return json(await service.revalidate(id.parse(path[1]), author, input.dateColumn));
  }
  if (method === "POST" && path[0] === "preview") return json(await service.preview(previewInput.parse(await body(request)), author));
  if (method === "POST" && path[0] === "commit") return json(await service.commit(commitInput.parse(await body(request)), author));
  if (method === "GET" && path[0] === "reports" && !path[1]) return json(await service.history(url.searchParams.get("before") || undefined));
  if (path[0] === "reports" && path[1]) {
    const { row, snapshot } = await service.report(id.parse(path[1]));
    if (method === "GET" && !path[2]) return json({ snapshot });
    if (path[2] === "document" && (method === "GET" || method === "POST")) {
      const key = `documents/${snapshot.id}.docx`;
      let bytes: Uint8Array | null = null;
      try { bytes = await qualityStorage.read(key); } catch { /* Not generated yet. */ }
      if (!bytes && method === "POST") {
        const { renderQualityWord } = await import("./document");
        // No client-provided charts, origin or metrics are used in the immutable document.
        const origin = new URL(process.env.NEXTAUTH_URL || request.url).origin;
        const generated = await renderQualityWord(snapshot, origin);
        try { await qualityStorage.write(key, generated, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); }
        catch { /* A concurrent request may have already stored the same version. */ }
        bytes = await qualityStorage.read(key);
      }
      if (!bytes) throw new QualityWeeklyError("Generate the Word document first.", 404);
      if (method === "POST") return json({ saved: true });
      return fileResponse(bytes, reportFilename(snapshot), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }
    if (method === "GET" && (path[2] === "source" || path[2] === "mapping")) {
      const source = path[2] === "source" ? row.import : row.import.mapping;
      if (!source) throw new QualityWeeklyError("Source not found.", 404);
      const bytes = await qualityStorage.read(source.asset.objectPath);
      if (sha256(bytes) !== source.digest) throw new QualityWeeklyError("Source integrity check failed.", 409);
      return fileResponse(bytes, source.asset.filename, /\.csv$/i.test(source.asset.filename) ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
  }
  throw new QualityWeeklyError("Endpoint not found.", 404);
}

export function qualityWeeklyFailure(error: unknown) {
  if (error instanceof QualityWeeklyError) return json({ error: error.message, details: error.details }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Check the selected period and required fields.", details: error.flatten() }, 400);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  console.error("Weekly Quality request failed", { code }); // Never log workbook cells, cookies or signed URLs.
  if (code === "P2021") return json({ error: "Weekly Quality setup is pending. The database migration must be applied before uploading." }, 503);
  return json({ error: "The request could not be completed. Saved versions have not been replaced. Please retry." }, 500);
}
