import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { recordErrorLog, registerStoredFile } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { type StorageBucket, uploadPublicObject, validateStorageUpload } from "@/lib/supabase-storage";

const muralBucket: StorageBucket = "mural-media";
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getApiActor();

  try {
    if (normalizeRole(actor.role) !== "ADMIN") {
      return NextResponse.json({ error: "Você não tem permissão para enviar capas do Mural." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione uma imagem para usar como capa." }, { status: 400 });
    }

    if (!allowedMimeTypes.has(file.type)) {
      return NextResponse.json({ error: "Formato inválido. Use PNG, JPG, JPEG ou WEBP." }, { status: 400 });
    }

    const validation = validateStorageUpload(actor, muralBucket, file);
    if ("error" in validation) {
      const errorMessage = validation.error ?? "Upload inválido.";
      recordErrorLog({ userEmail: actor.email, code: "MURAL_COVER_UPLOAD_VALIDATION", message: errorMessage, route: "/api/mural/uploads/cover", action: "UPLOAD", severity: "WARNING" });
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `covers/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await uploadPublicObject(muralBucket, path, file);
    const record = registerStoredFile(actor, {
      bucket: muralBucket,
      path,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      category: "mural-cover",
      entity: "MuralPost",
      ownerUserEmail: actor.email,
      isSensitive: false
    });

    return NextResponse.json({
      data: {
        imageUrl: uploaded.publicUrl,
        fileId: record.id,
        storagePath: uploaded.storagePath
      }
    }, { status: 201 });
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "MURAL_COVER_UPLOAD_ERROR",
      message: error instanceof Error ? error.message : "Erro ao enviar capa do Mural",
      route: "/api/mural/uploads/cover",
      action: "UPLOAD",
      severity: "ERROR"
    });
    return NextResponse.json({ error: "Não foi possível enviar a imagem do Mural. Tente novamente." }, { status: 500 });
  }
}
