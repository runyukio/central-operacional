import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { cleanShiftName } from "./shift-display";

export const SUPERVISION_MATRIX_KEY = "settings.supervisionAssignments";
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data inválida.");
export const supervisionAssignmentSchema = z.object({
  id: z.string().min(1),
  lobId: z.string().min(1),
  shift: z.enum(["Manhã", "Tarde", "Noite"]),
  supervisorId: z.string().min(1),
  startsOn: dateKey,
  endsOn: dateKey.nullable(),
  active: z.boolean()
}).refine((value) => !value.endsOn || value.endsOn >= value.startsOn, "Fim da responsabilidade anterior ao início.");
export type SupervisionAssignment = z.infer<typeof supervisionAssignmentSchema>;
export class SupervisionError extends Error {}
const supervisorRoles = ["SUPERVISOR", "GESTOR", "ADMIN", "WFM", "MANAGEMENT"];
const matrixDescription = "Supervisão por LOB, turno e vigência (datas inclusivas)";

function periodsOverlap(a: SupervisionAssignment, b: SupervisionAssignment) {
  return a.active && b.active && a.lobId === b.lobId && a.shift === b.shift
    && a.startsOn <= (b.endsOn ?? "9999-12-31") && b.startsOn <= (a.endsOn ?? "9999-12-31");
}

function eligibleSupervisor(supervisor: { deletedAt: Date | null; user: { status: string; role: { name: string } } | null } | null) {
  return Boolean(supervisor && !supervisor.deletedAt && supervisor.user?.status === "ACTIVE" && supervisorRoles.includes(supervisor.user.role.name));
}

// Use the existing central configuration store. No guessed historical backfill:
// current employee/team bindings cannot establish past responsibility dates.
export async function readSupervisionMatrix(client: Pick<Prisma.TransactionClient, "systemConfig"> = prisma) {
  const config = await client.systemConfig.findUnique({ where: { key: SUPERVISION_MATRIX_KEY } });
  if (!config) return [];
  const parsed = z.array(supervisionAssignmentSchema).safeParse(config.value);
  if (!parsed.success) throw new SupervisionError("Matriz de supervisão inválida. Corrija a configuração antes de aprovar trocas de turno.");
  return parsed.data;
}

export async function resolveShiftSupervisor(tx: Prisma.TransactionClient, input: {
  lobId: string; lobName: string; shift: string; effectiveDate: Date; employeeId: string;
}) {
  // Shared with matrix edits; covers even an absent config row.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(726393, 1)::text`;
  const day = input.effectiveDate.toISOString().slice(0, 10);
  const context = `LOB ${input.lobName || input.lobId}, novo turno ${cleanShiftName(input.shift)}, vigência ${day}`;
  let assignments: SupervisionAssignment[];
  try { assignments = await readSupervisionMatrix(tx); }
  catch (error) { throw new SupervisionError(`${context}: ${(error as Error).message}`); }
  const matches = assignments.filter((row) => row.active && row.lobId === input.lobId
    && row.shift === cleanShiftName(input.shift) && row.startsOn <= day && (!row.endsOn || row.endsOn >= day));
  if (!matches.length) throw new SupervisionError(`${context}: não há supervisão definida. Corrija a matriz de supervisão.`);
  if (matches.length !== 1) {
    const supervisors = await tx.employeeProfile.findMany({
      where: { id: { in: [...new Set(matches.map((row) => row.supervisorId))] } },
      select: { id: true, fullName: true }
    });
    throw new SupervisionError(`${context}: há ${matches.length} responsabilidades sobrepostas (${supervisors.map((row) => row.fullName).join(", ")}). Corrija a matriz antes de concluir a aprovação.`);
  }
  const assignment = matches[0];
  const supervisor = await tx.employeeProfile.findUnique({ where: { id: assignment.supervisorId } });
  if (!supervisor || supervisor.deletedAt || supervisor.id === input.employeeId) {
    throw new SupervisionError(`${context}: supervisor configurado indisponível ou inválido. Corrija a matriz de supervisão.`);
  }
  return assignment;
}

export async function saveSupervisionAssignment(tx: Prisma.TransactionClient, actorId: string, input: Record<string, unknown>) {
  const parsed = supervisionAssignmentSchema.safeParse({ ...input, id: input.id || randomUUID(), endsOn: input.endsOn || null });
  if (!parsed.success) return { error: `Matriz de supervisão: ${parsed.error.issues.map((issue) => issue.message).join(" ")}` };
  const row = parsed.data;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726393, 1)::text`;
  const matrix = await readSupervisionMatrix(tx);
  const [lob, supervisor] = await Promise.all([
    tx.lob.findUnique({ where: { id: row.lobId } }),
    tx.employeeProfile.findUnique({ where: { id: row.supervisorId }, include: { user: { include: { role: true } } } })
  ]);
  if (!lob || lob.name === "ALL") return { error: "Selecione uma LOB operacional válida." };
  if (!eligibleSupervisor(supervisor)) {
    return { error: "Selecione um supervisor ativo e elegível." };
  }
  const overlap = matrix.find((entry) => entry.id !== row.id && periodsOverlap(entry, row));
  if (overlap) return { error: `LOB ${lob.name}, turno ${row.shift}: já há supervisão no período informado. Encerre ou corrija a responsabilidade existente.` };
  const next = matrix.some((entry) => entry.id === row.id) ? matrix.map((entry) => entry.id === row.id ? row : entry) : [...matrix, row];
  await tx.systemConfig.upsert({
    where: { key: SUPERVISION_MATRIX_KEY },
    create: { key: SUPERVISION_MATRIX_KEY, value: next, description: matrixDescription },
    update: { value: next }
  });
  await tx.auditLog.create({ data: {
    actorId, action: "EDICAO", entity: "SupervisionAssignment", entityId: row.id,
    reason: "Configuração de supervisão por LOB, turno e vigência",
    previousValue: matrix.find((entry) => entry.id === row.id) ?? Prisma.JsonNull, newValue: row
  } });
  return { id: row.id };
}

export async function importInitialSupervisionMatrix(tx: Prisma.TransactionClient, actorId: string, input: unknown) {
  const parsed = z.array(supervisionAssignmentSchema).min(1).max(100).safeParse(input);
  if (!parsed.success) return { error: "Arquivo de matriz inválido. Confira a LOB, o turno, o supervisor e as datas de cada linha." };
  const rows = parsed.data;
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return { error: "A matriz contém identificadores duplicados." };
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726393, 1)::text`;
  if ((await readSupervisionMatrix(tx)).length) return { error: "A matriz já tem responsabilidades cadastradas. Edite os períodos existentes na tela de Supervisores." };

  const [lobs, supervisors] = await Promise.all([
    tx.lob.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.lobId))] }, name: { not: "ALL" } }, select: { id: true, name: true } }),
    tx.employeeProfile.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.supervisorId))] } }, select: {
      id: true, deletedAt: true, user: { select: { status: true, role: { select: { name: true } } } }
    } })
  ]);
  const lobById = new Map(lobs.map((lob) => [lob.id, lob.name]));
  const supervisorById = new Map(supervisors.map((supervisor) => [supervisor.id, supervisor]));
  for (const [index, row] of rows.entries()) {
    const lob = lobById.get(row.lobId);
    if (!lob) return { error: `Linha ${index + 1}: LOB operacional não encontrada.` };
    if (!eligibleSupervisor(supervisorById.get(row.supervisorId) ?? null)) return { error: `LOB ${lob}, turno ${row.shift}: supervisor não encontrado ou inelegível.` };
    if (rows.slice(0, index).some((other) => periodsOverlap(other, row))) return { error: `LOB ${lob}, turno ${row.shift}: períodos ativos sobrepostos.` };
  }
  await tx.systemConfig.upsert({
    where: { key: SUPERVISION_MATRIX_KEY },
    create: { key: SUPERVISION_MATRIX_KEY, value: rows, description: matrixDescription },
    update: { value: rows }
  });
  await tx.auditLog.createMany({ data: rows.map((row) => ({
    actorId, action: "CRIACAO", entity: "SupervisionAssignment", entityId: row.id,
    reason: "Importação inicial da matriz de supervisão", newValue: row
  })) });
  return { count: rows.length };
}
