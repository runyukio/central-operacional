import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type StatusValue = "ACTIVE" | "INACTIVE";

type StatusMap = Record<string, StatusValue>;

type RoleTitleConfig = {
  name: string;
  status: StatusValue;
};

type SettingsAction =
  | { type: "lob"; id?: string; name: string; description?: string; status?: StatusValue }
  | { type: "shift"; id?: string; name: string; startsAt: string; endsAt: string; color?: string; status?: StatusValue }
  | { type: "roleTitle"; name: string; previousName?: string; status?: StatusValue }
  | { type: "defaultMonth"; value: string };

const configKeys = {
  lobStatus: "settings.lobStatus",
  shiftStatus: "settings.shiftStatus",
  roleTitles: "settings.roleTitles",
  defaultMonth: "settings.defaultMonth"
};

export async function getSystemSettings(actor: Actor) {
  try {
    await assertAuthenticated(actor);
    const [lobs, shifts, roles, requestTypes, lobStatus, shiftStatus, roleTitles, defaultMonth] = await Promise.all([
      prisma.lob.findMany({ orderBy: { name: "asc" } }),
      prisma.shift.findMany({ orderBy: { name: "asc" } }),
      prisma.role.findMany({ orderBy: { name: "asc" } }),
      prisma.requestType.findMany({ orderBy: { name: "asc" } }),
      readStatusMap(configKeys.lobStatus),
      readStatusMap(configKeys.shiftStatus),
      readRoleTitles(),
      readStringConfig(configKeys.defaultMonth, "2026-05")
    ]);

    return {
      data: {
        lobs: lobs.map((lob) => ({ id: lob.id, name: lob.name, description: lob.description ?? "", status: lobStatus[lob.id] ?? "ACTIVE" })),
        shifts: shifts.map((shift) => ({ id: shift.id, name: shift.name, startsAt: shift.startsAt, endsAt: shift.endsAt, color: shift.color, status: shiftStatus[shift.id] ?? "ACTIVE" })),
        roles: roles.map((role) => ({ id: role.id, name: role.name, label: role.label })),
        requestTypes: requestTypes.map((type) => ({ id: type.id, name: type.name, area: type.area, slaHours: type.slaHours, requiresApproval: type.requiresApproval })),
        roleTitles,
        defaultMonth
      }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SETTINGS_LIST_ERROR", message: error instanceof Error ? error.message : "Falha ao listar configurações", route: "/api/settings", action: "SETTINGS_LIST", severity: "ERROR" });
    return { data: { lobs: [], shifts: [], roles: [], requestTypes: [], roleTitles: [], defaultMonth: "2026-05" } };
  }
}

export async function updateSystemSettings(actor: Actor, action: SettingsAction) {
  try {
    const admin = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!admin || normalizeRole(actor.role) !== "ADMIN") return { error: "Apenas Admin pode alterar configurações." };

    const result = await prisma.$transaction(async (tx) => {
      if (action.type === "lob") {
        const name = action.name.trim();
        if (!name) return { error: "Nome da LOB é obrigatório." };
        const lob = action.id
          ? await tx.lob.update({ where: { id: action.id }, data: { name, description: action.description?.trim() || null } })
          : await tx.lob.upsert({ where: { name }, update: { description: action.description?.trim() || null }, create: { name, description: action.description?.trim() || null } });
        if (action.status) await writeStatus(tx, configKeys.lobStatus, lob.id, action.status);
        await auditSettings(tx, admin.id, action.id ? "EDICAO" : "CRIACAO", "Lob", lob.id, action);
        return { data: lob };
      }

      if (action.type === "shift") {
        const name = action.name.trim();
        if (!name || !action.startsAt || !action.endsAt) return { error: "Nome, entrada e saída do turno são obrigatórios." };
        const shift = action.id
          ? await tx.shift.update({ where: { id: action.id }, data: { name, startsAt: action.startsAt, endsAt: action.endsAt, color: action.color || "#2563EB" } })
          : await tx.shift.upsert({ where: { name }, update: { startsAt: action.startsAt, endsAt: action.endsAt, color: action.color || "#2563EB" }, create: { name, startsAt: action.startsAt, endsAt: action.endsAt, color: action.color || "#2563EB" } });
        if (action.status) await writeStatus(tx, configKeys.shiftStatus, shift.id, action.status);
        await auditSettings(tx, admin.id, action.id ? "EDICAO" : "CRIACAO", "Shift", shift.id, action);
        return { data: shift };
      }

      if (action.type === "roleTitle") {
        const name = action.name.trim();
        if (!name) return { error: "Nome do cargo/função é obrigatório." };
        const current = await readRoleTitles(tx);
        const next = upsertRoleTitle(current, action.previousName, name, action.status ?? "ACTIVE");
        await tx.systemConfig.upsert({
          where: { key: configKeys.roleTitles },
          update: { value: next as unknown as Prisma.InputJsonValue, description: "Cargos/funções operacionais configuráveis" },
          create: { key: configKeys.roleTitles, value: next as unknown as Prisma.InputJsonValue, description: "Cargos/funções operacionais configuráveis" }
        });
        await auditSettings(tx, admin.id, "EDICAO", "SystemConfig", configKeys.roleTitles, action);
        return { data: next };
      }

      if (action.type === "defaultMonth") {
        const value = action.value.trim();
        if (!/^\d{4}-\d{2}$/.test(value)) return { error: "Mês padrão deve estar no formato AAAA-MM." };
        await tx.systemConfig.upsert({
          where: { key: configKeys.defaultMonth },
          update: { value, description: "Mês padrão para testes locais" },
          create: { key: configKeys.defaultMonth, value, description: "Mês padrão para testes locais" }
        });
        await auditSettings(tx, admin.id, "EDICAO", "SystemConfig", configKeys.defaultMonth, action);
        return { data: { value } };
      }

      return { error: "Ação de configuração inválida." };
    });

    if ("error" in result) return result;
    return { success: true, ...result };
  } catch (error) {
    console.error("[settings] erro ao salvar configuração", error);
    recordErrorLog({ userEmail: actor.email, code: "SETTINGS_SAVE_ERROR", message: error instanceof Error ? error.message : "Falha ao salvar configurações", route: "/api/settings", action: "SETTINGS_SAVE", severity: "ERROR" });
    return { error: "Não foi possível salvar a configuração." };
  }
}

async function assertAuthenticated(actor: Actor) {
  if (!actor.email) throw new Error("Usuário não autenticado.");
}

async function readStatusMap(key: string, client: Pick<typeof prisma, "systemConfig"> = prisma): Promise<StatusMap> {
  const config = await client.systemConfig.findUnique({ where: { key } });
  if (!config || typeof config.value !== "object" || Array.isArray(config.value) || !config.value) return {};
  return Object.fromEntries(Object.entries(config.value).map(([id, status]) => [id, status === "INACTIVE" ? "INACTIVE" : "ACTIVE"]));
}

async function readRoleTitles(client: Pick<typeof prisma, "systemConfig"> = prisma): Promise<RoleTitleConfig[]> {
  const config = await client.systemConfig.findUnique({ where: { key: configKeys.roleTitles } });
  if (!Array.isArray(config?.value)) {
    return ["Agente", "Supervisor", "WFM", "Qualidade", "RH", "Logística/TI", "Coordenador", "Gerente", "Outro"].map((name) => ({ name, status: "ACTIVE" }));
  }
  return config.value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      if (!name) return null;
      return { name, status: record.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" } satisfies RoleTitleConfig;
    })
    .filter((item): item is RoleTitleConfig => Boolean(item));
}

async function readStringConfig(key: string, fallback: string) {
  const config = await prisma.systemConfig.findUnique({ where: { key } });
  return typeof config?.value === "string" ? config.value : fallback;
}

async function writeStatus(tx: Prisma.TransactionClient, key: string, id: string, status: StatusValue) {
  const current = await readStatusMap(key, tx);
  const next = { ...current, [id]: status };
  await tx.systemConfig.upsert({
    where: { key },
    update: { value: next as Prisma.InputJsonValue },
    create: { key, value: next as Prisma.InputJsonValue, description: "Status configurável" }
  });
}

function upsertRoleTitle(current: RoleTitleConfig[], previousName: string | undefined, name: string, status: StatusValue) {
  const index = current.findIndex((item) => item.name === (previousName || name));
  if (index >= 0) {
    return current.map((item, itemIndex) => (itemIndex === index ? { name, status } : item));
  }
  return [...current, { name, status }];
}

async function auditSettings(tx: Prisma.TransactionClient, actorId: string, action: "CRIACAO" | "EDICAO", entity: string, entityId: string, payload: unknown) {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId,
      reason: "Alteração em Configurações",
      newValue: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue
    }
  });
}
