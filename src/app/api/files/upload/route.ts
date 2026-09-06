import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { recordErrorLog } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { genericUploadOwnershipError } from "@/lib/generic-upload-ownership";
import { type StorageBucket, deletePrivateObject, uploadPrivateObject, validateStorageUpload } from "@/lib/supabase-storage";

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

    const user = await prisma.user.findFirst({
      where: { email: { equals: actor.email, mode: "insensitive" }, status: "ACTIVE", deletedAt: null },
      select: { id: true, email: true, employeeProfile: { select: { id: true } } }
    });
    if (!user) return NextResponse.json({ error: "Sessão inválida. Entre novamente." }, { status: 401 });
    const ownershipError = genericUploadOwnershipError({ email: user.email, employeeId: user.employeeProfile?.id }, {
      ownerUserEmail, employeeId, entity, entityId
    });
    if (ownershipError) return NextResponse.json({ error: ownershipError }, { status: 403 });

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
    let record;
    try {
      record = await prisma.$transaction(async (tx) => {
        const stored = await tx.storedFile.create({ data: {
          bucket, path: uploaded.storagePath, fileName: file.name,
          mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
          category, employeeId: user.employeeProfile?.id, ownerUserId: user.id,
          uploadedById: user.id, isSensitive: true
        } });
        await tx.auditLog.create({ data: {
          actorId: user.id, action: "UPLOAD", entity: "StoredFile", entityId: stored.id,
          reason: "Upload privado do usuário autenticado",
          newValue: { bucket, path: uploaded.storagePath, fileName: file.name, sizeBytes: file.size }
        } });
        return stored;
      });
    } catch (error) {
      // Compensate only this newly created object, never an existing document.
      await deletePrivateObject(bucket as StorageBucket, uploaded.storagePath).catch(() => undefined);
      throw error;
    }

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
