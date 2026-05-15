import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { recordErrorLog, registerStoredFile } from "@/lib/mock-db";
import { type StorageBucket, uploadPrivateObject, validateStorageUpload } from "@/lib/supabase-storage";

export async function POST(request: Request) {
  const actor = await getApiActor();

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const bucket = String(formData.get("bucket") ?? "");
    const category = String(formData.get("category") ?? bucket);
    const entity = String(formData.get("entity") ?? "");
    const entityId = String(formData.get("entityId") ?? "");
    const employeeId = String(formData.get("employeeId") ?? "");
    const ownerUserEmail = String(formData.get("ownerUserEmail") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione um arquivo para upload." }, { status: 400 });
    }

    const validation = validateStorageUpload(actor, bucket, file);
    if ("error" in validation) {
      const errorMessage = validation.error ?? "Upload inválido.";
      recordErrorLog({ userEmail: actor.email, code: "UPLOAD_VALIDATION_ERROR", message: errorMessage, route: "/api/files/upload", action: "UPLOAD", severity: "WARNING" });
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await uploadPrivateObject(bucket as StorageBucket, path, file);
    const record = registerStoredFile(actor, {
      bucket,
      path,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      category,
      entity: entity || undefined,
      entityId: entityId || undefined,
      employeeId: employeeId || undefined,
      ownerUserEmail: ownerUserEmail || actor.email,
      isSensitive: true
    });

    return NextResponse.json({ data: record, storage: uploaded }, { status: 201 });
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "UPLOAD_STORAGE_ERROR",
      message: error instanceof Error ? error.message : "Erro ao enviar arquivo",
      route: "/api/files/upload",
      action: "UPLOAD",
      severity: "ERROR"
    });
    return NextResponse.json({ error: "Não foi possível enviar o arquivo. Tente novamente ou acione o admin." }, { status: 500 });
  }
}
