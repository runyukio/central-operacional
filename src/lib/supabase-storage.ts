import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Actor } from "@/lib/mock-db";
import { roleHasCapability } from "@/lib/access-control";

export const storageBuckets = {
  "schedule-imports": { maxBytes: 10 * 1024 * 1024, extensions: [".xlsx", ".csv"] },
  "request-attachments": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".csv"] },
  "quality-materials": { maxBytes: 30 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx"] },
  "equipment-evidence": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg"] },
  "employee-documents": { maxBytes: 5 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx"] },
  "absence-evidence": { maxBytes: 5 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg"] },
  "shift-report-attachments": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".csv"] },
  "billing-invoices": { maxBytes: 10 * 1024 * 1024, extensions: [".pdf", ".xml", ".png", ".jpg", ".jpeg"] },
  "mural-media": { maxBytes: 5 * 1024 * 1024, extensions: [".png", ".jpg", ".jpeg", ".webp"] }
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

  if (!canUploadToBucket(actor, bucket as StorageBucket)) return { error: "Você não tem permissão para enviar arquivos nesta categoria." };

  const extension = getExtension(file.name);
  if (!config.extensions.includes(extension as never)) {
    return { error: `Formato não permitido. Use: ${config.extensions.join(", ")}.` };
  }

  if (file.size > config.maxBytes) {
    return { error: `Arquivo acima do limite de ${formatBytes(config.maxBytes)} para esta categoria.` };
  }

  return { ok: true as const };
}

function canUploadToBucket(actor: Actor, bucket: StorageBucket) {
  switch (bucket) {
    case "schedule-imports":
      return roleHasCapability(actor.role, "SCHEDULE_EDIT");
    case "request-attachments":
      return roleHasCapability(actor.role, "PERSONAL") || roleHasCapability(actor.role, "PIPELINES");
    case "quality-materials":
      return roleHasCapability(actor.role, "QUALITY_MATERIALS_MANAGE");
    case "equipment-evidence":
      return roleHasCapability(actor.role, "EQUIPMENT_MANAGE");
    case "employee-documents":
      return roleHasCapability(actor.role, "EMPLOYEE_SENSITIVE") && roleHasCapability(actor.role, "EMPLOYEE_EDIT");
    case "absence-evidence":
      return roleHasCapability(actor.role, "ATTENDANCE_MANAGE") || roleHasCapability(actor.role, "ATTENDANCE_JUSTIFY");
    case "shift-report-attachments":
      return roleHasCapability(actor.role, "PIPELINES");
    case "billing-invoices":
      return roleHasCapability(actor.role, "PERSONAL") || roleHasCapability(actor.role, "BILLING_VIEW");
    case "mural-media":
      return roleHasCapability(actor.role, "SETTINGS");
  }
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

export async function downloadPrivateObject(bucket: StorageBucket, path: string) {
  if (!isStorageConfigured()) {
    const relativePath = normalizeLocalPrivatePath(bucket, path);
    const absolutePath = resolve(process.cwd(), "storage", "local", relativePath);
    return { data: await readFile(absolutePath), contentType: "application/octet-stream" };
  }

  const encodedPath = encodeStoragePath(path);
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${encodedPath}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "Não foi possível baixar o arquivo privado.");
  }

  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream"
  };
}

export async function deletePrivateObject(bucket: StorageBucket, path: string) {
  if (!isStorageConfigured()) {
    const relativePath = normalizeLocalPrivatePath(bucket, path);
    const absolutePath = resolve(process.cwd(), "storage", "local", relativePath);
    await unlink(absolutePath).catch(() => undefined);
    return;
  }

  const encodedPath = encodeStoragePath(path);
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`, {
    method: "DELETE",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "Não foi possível excluir o arquivo privado anterior.");
  }
}

export async function uploadPublicObject(bucket: StorageBucket, path: string, file: File) {
  if (!isStorageConfigured()) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
      throw new Error("Supabase Storage não configurado. Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente de produção.");
    }
    return uploadLocalPublicObject(bucket, path, file);
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

  return { storagePath: path, publicUrl: getPublicObjectUrl(bucket, path), skipped: false };
}

export function getPublicObjectUrl(bucket: StorageBucket, path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
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

async function uploadLocalPublicObject(bucket: StorageBucket, path: string, file: File) {
  const safePath = path.replace(/^\/+/, "").replace(/\.\./g, "");
  const relativePath = `uploads/${bucket}/${safePath}`;
  const absolutePath = resolve(process.cwd(), "public", relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));
  return {
    storagePath: safePath,
    publicUrl: `/${relativePath}`,
    localPath: absolutePath,
    skipped: false,
    provider: "local"
  };
}

function getExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function encodeStoragePath(path: string) {
  return path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

function normalizeLocalPrivatePath(bucket: StorageBucket, path: string) {
  const safePath = path.replace(/^\/+/, "").replace(/\.\./g, "");
  return safePath.startsWith(`${bucket}/`) ? safePath : `${bucket}/${safePath}`;
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
