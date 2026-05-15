import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Actor } from "@/lib/mock-db";
import { canManageEquipment, canViewEmployeeSensitiveData, canViewShiftReport, normalizeRole } from "@/lib/permissions";

export const storageBuckets = {
  "schedule-imports": { maxBytes: 10 * 1024 * 1024, extensions: [".xlsx", ".csv"], roles: ["ADMIN", "GESTOR", "WFM"] },
  "request-attachments": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".csv"], roles: ["ADMIN", "GESTOR", "SUPERVISOR", "COLABORADOR", "WFM", "RH", "TI", "QUALIDADE"] },
  "quality-materials": { maxBytes: 30 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx"], roles: ["ADMIN", "GESTOR", "QUALIDADE"] },
  "equipment-evidence": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg"], roles: ["ADMIN", "GESTOR", "TI"] },
  "employee-documents": { maxBytes: 5 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx"], roles: ["ADMIN", "GESTOR", "RH"] },
  "absence-evidence": { maxBytes: 5 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg"], roles: ["ADMIN", "GESTOR", "WFM", "SUPERVISOR", "RH"] },
  "shift-report-attachments": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".csv"], roles: ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"] }
} as const;

export type StorageBucket = keyof typeof storageBuckets;

export function isStorageConfigured() {
  if (process.env.USE_LOCAL_DB === "true" || process.env.APP_ENV === "local") return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return false;
  return !/PROJECT_REF|SUPABASE_|SERVICE_ROLE_KEY/.test(`${url}${key}`);
}

export function validateStorageUpload(actor: Actor, bucket: string, file: File) {
  const config = storageBuckets[bucket as StorageBucket];
  if (!config) return { error: "Bucket não configurado para a Central Operacional." };

  const role = normalizeRole(actor.role);
  if (!(config.roles as readonly string[]).includes(role)) return { error: "Você não tem permissão para enviar arquivos nesta categoria." };

  const extension = getExtension(file.name);
  if (!config.extensions.includes(extension as never)) {
    return { error: `Formato não permitido. Use: ${config.extensions.join(", ")}.` };
  }

  if (file.size > config.maxBytes) {
    return { error: `Arquivo acima do limite de ${formatBytes(config.maxBytes)} para esta categoria.` };
  }

  if (bucket === "employee-documents" && !canViewEmployeeSensitiveData(actor)) {
    return { error: "Documentos cadastrais são restritos a RH, Gestão e Admin." };
  }

  if (bucket === "equipment-evidence" && !canManageEquipment(actor)) {
    return { error: "Evidências de equipamento são restritas a Logística/TI e gestão." };
  }

  if (bucket === "shift-report-attachments" && !canViewShiftReport(actor)) {
    return { error: "Anexos de report de turno são restritos aos perfis operacionais permitidos." };
  }

  return { ok: true as const };
}

export async function uploadPrivateObject(bucket: StorageBucket, path: string, file: File) {
  if (!isStorageConfigured()) {
    return uploadLocalObject(bucket, path, file);
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false"
    },
    body: await file.arrayBuffer()
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "Falha ao enviar arquivo para Supabase Storage.");
  }

  return { storagePath: path, skipped: false };
}

async function uploadLocalObject(bucket: StorageBucket, path: string, file: File) {
  const safePath = path.replace(/^\/+/, "").replace(/\.\./g, "");
  const relativePath = `${bucket}/${safePath}`;
  const absolutePath = resolve(process.cwd(), "storage", "local", relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));
  return {
    storagePath: relativePath,
    localPath: absolutePath,
    skipped: false,
    provider: "local"
  };
}

function getExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
