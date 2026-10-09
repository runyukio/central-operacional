import { Prisma, type EmployeeProfile, type Schedule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextRequestCode } from "@/lib/request-code";
import { normalizeRole } from "@/lib/permissions";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import { shiftCategoryName } from "@/lib/shift-display";
import type { Actor, RequestStatus } from "@/lib/mock-db";
import type { CreateRequestInput } from "@/lib/request-service";

export const PAIRED_SWAP_TYPE = "Troca Casada";
export const PAIRED_SWAP_KIND = "PAIRED_DAY_OFF_SWAP";
export class PairedSwapError extends Error {}

const include = {
  type: true, requester: true, assignee: true,
  employee: { include: { lob: true, supervisor: true } },
  history: { include: { actor: true }, orderBy: { createdAt: "desc" as const }, take: 30 },
  comments: { include: { author: true }, orderBy: { createdAt: "desc" as const }, take: 20 }
};
type PairedRequest = Prisma.RequestGetPayload<{ include: typeof include }>;
type Partner = EmployeeProfile & { user: { id: string; status: string } | null; shift: { name: string }; lob: { name: string } };
type Snapshot = Pick<Schedule, "id" | "employeeId" | "status" | "startsAt" | "endsAt" | "shiftId" | "lobId" | "supervisorId">;
type SwapPayload = {
  internalType: typeof PAIRED_SWAP_KIND;
  dayOffKind: typeof PAIRED_SWAP_KIND;
  stage: "PARTNER" | "SUPERVISOR" | "WFM" | "DONE";
  partnerEmployeeId: string; partnerUserId: string; partnerName: string;
  currentDayOffDate: string; desiredDayOffDate: string;
  requesterAcceptedAt: string; partnerAcceptedAt: string | null;
  supervisorApprovedAt?: string; supervisorApprovedById?: string;
  wfmApprovedAt?: string; wfmApprovedById?: string;
  snapshots: Snapshot[]; justification: string;
  scheduleApplicationStatus: string;
};

export function isPairedSwap(type: string, payload?: unknown) {
  return type === PAIRED_SWAP_TYPE || (payload as Partial<SwapPayload> | null)?.internalType === PAIRED_SWAP_KIND;
}

function operationalToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validatePairedDates(current?: string, desired?: string, today = operationalToday()) {
  for (const date of [current, desired]) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      throw new PairedSwapError("Informe duas datas válidas para a troca casada.");
    }
    if (date <= today) throw new PairedSwapError("A troca casada deve envolver duas datas futuras.");
  }
  if (current === desired) throw new PairedSwapError("As duas datas da troca casada devem ser diferentes.");
}

function isEligiblePartner(partner: Partner) {
  return !partner.deletedAt && !partner.terminationDate && partner.user?.status === "ACTIVE" && isAgentJobTitle(partner.roleTitle)
    && ["ativo", "online", "active"].includes(normalizeComparableJobTitle(partner.operationalStatus))
    && ["Manhã", "Tarde", "Noite"].includes(shiftCategoryName(partner.shift.name));
}

async function partners(tx: Prisma.TransactionClient, requesterId: string, partnerEmployeeId: string) {
  await tx.$queryRaw`SELECT id FROM "EmployeeProfile" WHERE "userId" = ${requesterId} OR id = ${partnerEmployeeId} ORDER BY id FOR UPDATE`;
  const rows = await tx.employeeProfile.findMany({
    where: { OR: [{ userId: requesterId }, { id: partnerEmployeeId }] },
    include: { user: { select: { id: true, status: true } }, shift: { select: { name: true } }, lob: { select: { name: true } } }
  });
  const requester = rows.find(row => row.userId === requesterId);
  const partner = rows.find(row => row.id === partnerEmployeeId);
  if (!requester || !partner || !isEligiblePartner(requester) || !isEligiblePartner(partner)) throw new PairedSwapError("Os dois parceiros devem estar ativos e vinculados a usuários ativos.");
  if (requester.id === partner.id) throw new PairedSwapError("Escolha outro parceiro para a troca casada.");
  if (requester.lobId !== partner.lobId || requester.shiftId !== partner.shiftId) throw new PairedSwapError("A troca casada só é permitida entre parceiros da mesma LOB e do mesmo turno.");
  if (!requester.supervisorId) throw new PairedSwapError("O solicitante precisa ter um supervisor cadastrado.");
  return { requester, partner };
}

function snapshot(row: Schedule): Snapshot {
  return { id: row.id, employeeId: row.employeeId, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, shiftId: row.shiftId, lobId: row.lobId, supervisorId: row.supervisorId };
}

async function schedules(tx: Prisma.TransactionClient, requester: Partner, partner: Partner, current: string, desired: string) {
  validatePairedDates(current, desired);
  const rows = await tx.schedule.findMany({ where: {
    employeeId: { in: [requester.id, partner.id] }, date: { in: [new Date(`${current}T00:00:00Z`), new Date(`${desired}T00:00:00Z`)] }, deletedAt: null
  } });
  const at = (id: string, date: string) => rows.find(row => row.employeeId === id && row.date.toISOString().slice(0, 10) === date);
  const ordered = [at(requester.id, current), at(requester.id, desired), at(partner.id, current), at(partner.id, desired)];
  if (ordered.some(row => !row)) throw new PairedSwapError("Os dois parceiros precisam ter cronograma nas duas datas.");
  const [requesterOff, requesterWork, partnerWork, partnerOff] = ordered as Schedule[];
  if (![requesterOff, partnerOff].every(row => ["FOLGA", "FOLGA_APROVADA"].includes(row.status))
    || ![requesterWork, partnerWork].every(row => ["ESCALADO", "TROCA_APROVADA"].includes(row.status))) {
    throw new PairedSwapError("Na sua folga o parceiro deve estar escalado; na folga dele você deve estar escalado.");
  }
  for (const row of [requesterWork, partnerWork]) {
    if ((row.lobId ?? requester.lobId) !== requester.lobId || (row.shiftId ?? requester.shiftId) !== requester.shiftId || !row.startsAt || !row.endsAt) {
      throw new PairedSwapError("Os cronogramas de trabalho devem ter horários e pertencer à mesma LOB e turno dos parceiros.");
    }
  }
  return [requesterOff, requesterWork, partnerWork, partnerOff];
}

// Serialize paired invitations and decisions; schedule writes also compare the saved state.
async function lock(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726391, 2)::text`;
}

export async function listPairedSwapPartners(userId: string) {
  const requester = await prisma.employeeProfile.findUnique({ where: { userId }, include: { user: { select: { id: true, status: true } }, shift: { select: { name: true } }, lob: { select: { name: true } } } });
  if (!requester || !isEligiblePartner(requester)) throw new PairedSwapError("Seu usuário precisa estar vinculado a um parceiro ativo.");
  const rows = await prisma.employeeProfile.findMany({
    where: { id: { not: requester.id }, lobId: requester.lobId, shiftId: requester.shiftId, deletedAt: null, user: { status: "ACTIVE" } },
    include: { user: { select: { id: true, status: true } }, shift: { select: { name: true } }, lob: { select: { name: true } } }, orderBy: { fullName: "asc" }
  });
  return rows.filter(isEligiblePartner).map(row => ({ id: row.id, name: row.fullName, wbLogin: row.wbLogin, lob: row.lob.name, shift: row.shift.name }));
}

async function notify(tx: Prisma.TransactionClient, request: PairedRequest, ids: string[], body: string) {
  for (const userId of new Set(ids)) await tx.notification.create({ data: {
    userId, title: "Troca casada", body, category: "Solicitações", type: "REQUEST", entity: "Request", entityId: request.id,
    href: userId === request.requesterId || userId === (request.payload as unknown as SwapPayload).partnerUserId ? `/minha-escala?request=${request.code}` : `/esteiras?request=${request.code}`
  } });
}

async function supervisorUserId(tx: Prisma.TransactionClient, supervisorId: string | null) {
  const supervisor = supervisorId ? await tx.employeeProfile.findUnique({ where: { id: supervisorId }, select: { userId: true } }) : null;
  if (!supervisor?.userId) throw new PairedSwapError("O supervisor do solicitante precisa ter um usuário vinculado.");
  return supervisor.userId;
}

export async function createPairedSwap(userId: string, input: CreateRequestInput) {
  if (!input.partnerEmployeeId || !input.acknowledgement || !input.justification?.trim()) throw new PairedSwapError("Selecione o parceiro, informe a justificativa e confirme seu aceite da troca casada.");
  validatePairedDates(input.currentDayOffDate, input.desiredDayOffDate);
  return prisma.$transaction(async tx => {
    await lock(tx);
    const { requester, partner } = await partners(tx, userId, input.partnerEmployeeId!);
    await supervisorUserId(tx, requester.supervisorId);
    const rows = await schedules(tx, requester, partner, input.currentDayOffDate!, input.desiredDayOffDate!);
    const pending = await tx.request.findMany({ where: {
      deletedAt: null, type: { name: { in: [PAIRED_SWAP_TYPE, "Troca de Folga", "Venda de Folga", "Solicitação de Dia de Folga", "Troca de Turno"] } }, status: { in: ["ABERTO", "EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"] },
      OR: [{ employeeId: { in: [requester.id, partner.id] } }, { payload: { path: ["partnerEmployeeId"], equals: requester.id } }, { payload: { path: ["partnerEmployeeId"], equals: partner.id } }]
    }, select: { payload: true } });
    const dates = [input.currentDayOffDate!, input.desiredDayOffDate!];
    if (pending.some(row => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return ["currentDayOffDate", "desiredDayOffDate", "desiredDayOffRequestDate", "dayOffToSellDate", "requestedDate", "shiftChangeStartDate", "shiftChangeDate"].some(key => dates.includes(String(payload[key] ?? "")))
        || (payload.shiftChangeStartDate && dates.some(date => date >= String(payload.shiftChangeStartDate) && (!payload.shiftChangeEndDate || date <= String(payload.shiftChangeEndDate))));
    })) throw new PairedSwapError("Já existe uma solicitação pendente envolvendo um dos parceiros nas datas escolhidas.");
    const type = await tx.requestType.findUnique({ where: { name: PAIRED_SWAP_TYPE } });
    if (!type) throw new PairedSwapError("Troca Casada ainda não está configurada. Aplique a migração deste recurso.");
    const payload: SwapPayload = {
      internalType: PAIRED_SWAP_KIND, dayOffKind: PAIRED_SWAP_KIND, stage: "PARTNER",
      partnerEmployeeId: partner.id, partnerUserId: partner.userId!, partnerName: partner.fullName,
      currentDayOffDate: input.currentDayOffDate!, desiredDayOffDate: input.desiredDayOffDate!,
      requesterAcceptedAt: new Date().toISOString(), partnerAcceptedAt: null, snapshots: rows.map(snapshot),
      justification: input.justification!, scheduleApplicationStatus: "PENDING"
    };
    const request = await tx.request.create({ data: {
      code: await nextRequestCode(tx), typeId: type.id, requesterId: userId, employeeId: requester.id,
      assignedArea: "WFM", title: input.title, description: input.description, priority: "MEDIA", status: "ABERTO",
      payload: payload as unknown as Prisma.InputJsonObject,
      history: { create: { actorId: userId, action: "Aceite do solicitante", to: "ABERTO", reason: input.justification } }
    }, include });
    await tx.auditLog.create({ data: { actorId: userId, action: "CRIACAO", entity: "Request", entityId: request.id, newValue: payload as unknown as Prisma.InputJsonObject } });
    await notify(tx, request, [userId, partner.userId!], `${request.code}: ${requester.fullName} propôs trocar a folga de ${input.currentDayOffDate} pela folga de ${input.desiredDayOffDate} de ${partner.fullName}. Aguardando aceite do parceiro.`);
    return request;
  }, { timeout: 15000 });
}

function pairedSwapDecision(payload: SwapPayload, userId: string, requesterId: string, role: string, supervisorId: string, status: RequestStatus) {
  if (payload.stage === "DONE") throw new PairedSwapError("Esta troca casada já foi encerrada.");
  if (status === "Cancelado" && userId === requesterId) return "CANCEL";
  const normalized = normalizeRole(role);
  const authorized = payload.stage === "PARTNER" ? userId === payload.partnerUserId
    : payload.stage === "SUPERVISOR" ? userId === supervisorId && normalized === "SUPERVISOR"
    : payload.stage === "WFM" && normalized === "WFM";
  if (!authorized) throw new PairedSwapError("Sem permissão para decidir nesta etapa da troca casada.");
  if (status === "Recusado") return "REJECT";
  if (status !== "Aprovado") throw new PairedSwapError("Use aceitar ou recusar na etapa atual da troca casada.");
  return payload.stage;
}

export async function updatePairedSwap(actor: Actor, userId: string, id: string, status: RequestStatus, reason?: string) {
  return prisma.$transaction(async tx => {
    await lock(tx);
    const request = await tx.request.findUniqueOrThrow({ where: { id }, include });
    if (request.deletedAt) throw new PairedSwapError("Solicitação não encontrada.");
    if (["APROVADO", "RECUSADO", "CANCELADO", "CONCLUIDO"].includes(request.status)) throw new PairedSwapError("Esta troca casada já foi encerrada.");
    const payload = request.payload as unknown as SwapPayload;
    const supervisorId = status === "Cancelado" && request.requesterId === userId || status === "Recusado" && payload.stage === "PARTNER" ? "" : await supervisorUserId(tx, request.employee?.supervisorId ?? null);
    const decision = pairedSwapDecision(payload, userId, request.requesterId, actor.role, supervisorId, status);
    if (decision === "REJECT" && !reason?.trim()) throw new PairedSwapError("Informe o motivo da recusa.");
    const now = new Date().toISOString();
    let nextStatus: PairedRequest["status"] = request.status;
    let action = "";
    const recipients = [request.requesterId, payload.partnerUserId];
    if (decision === "CANCEL" || decision === "REJECT") {
      nextStatus = decision === "CANCEL" ? "CANCELADO" : "RECUSADO";
      action = decision === "CANCEL" ? "Cancelamento da troca casada" : "Recusa da troca casada";
      payload.stage = "DONE";
      payload.scheduleApplicationStatus = "NOT_APPLIED";
    } else {
      const { requester, partner } = await partners(tx, request.requesterId, payload.partnerEmployeeId);
      if (partner.userId !== payload.partnerUserId || requester.id !== request.employeeId) throw new PairedSwapError("Os vínculos dos parceiros mudaram. Cancele e solicite uma nova troca.");
      const rows = await schedules(tx, requester, partner, payload.currentDayOffDate, payload.desiredDayOffDate);
      // JSONB may reorder object keys; compare values instead of serialized property order.
      const unchanged = payload.snapshots?.length === rows.length && rows.every((row, index) => {
        const saved = payload.snapshots[index] as unknown as Record<string, unknown>;
        return saved && Object.entries(snapshot(row)).every(([key, value]) => saved[key] === value);
      });
      if (!unchanged) throw new PairedSwapError("O cronograma mudou desde o aceite. Cancele e solicite uma nova troca casada.");
      if (decision === "PARTNER") {
        payload.partnerAcceptedAt = now; payload.stage = "SUPERVISOR";
        action = "Aceite do parceiro"; recipients.push(supervisorId);
      } else if (decision === "SUPERVISOR") {
        if (!payload.partnerAcceptedAt || !payload.requesterAcceptedAt) throw new PairedSwapError("Os dois parceiros precisam aceitar antes do supervisor.");
        payload.supervisorApprovedAt = now; payload.supervisorApprovedById = userId; payload.stage = "WFM";
        nextStatus = "EM_ANALISE"; action = "Aprovação do supervisor";
        const wfm = await tx.user.findMany({ where: { status: "ACTIVE", role: { name: "WFM" } }, select: { id: true } });
        recipients.push(...wfm.map(row => row.id));
      } else {
        if (!payload.partnerAcceptedAt || !payload.requesterAcceptedAt || !payload.supervisorApprovedAt || payload.supervisorApprovedById !== supervisorId) throw new PairedSwapError("A troca precisa dos dois aceites e da aprovação do supervisor antes do WFM.");
        // Preserve daily coverage and exact working hours by transferring the work on each date.
        const sources = [rows[2], rows[3], rows[0], rows[1]];
        for (const [index, row] of rows.entries()) {
          const source = sources[index];
          const work = index === 0 || index === 3;
          const data = {
            status: work ? "TROCA_APROVADA" as const : "FOLGA_APROVADA" as const,
            startsAt: work ? source.startsAt : null, endsAt: work ? source.endsAt : null,
            shiftId: work ? source.shiftId ?? requester.shiftId : row.shiftId, lobId: work ? source.lobId ?? requester.lobId : row.lobId,
            source: "paired-day-off-swap", observation: `Troca casada aprovada: ${request.code}`
          };
          const changed = await tx.schedule.updateMany({ where: { ...snapshot(row), updatedAt: row.updatedAt, deletedAt: null }, data });
          if (changed.count !== 1) throw new PairedSwapError("O cronograma foi alterado por outra ação. A troca não foi aplicada.");
          await tx.scheduleChangeHistory.create({ data: { scheduleId: row.id, employeeId: row.employeeId, date: row.date, changedById: userId, before: snapshot(row), after: data, previousValue: snapshot(row), newValue: data, reason: data.observation } });
          await tx.auditLog.create({ data: { actorId: userId, action: "ALTERACAO_ESCALA", entity: "Schedule", entityId: row.id, previousValue: snapshot(row), newValue: { ...data, requestId: id }, reason: data.observation } });
        }
        payload.stage = "DONE"; payload.scheduleApplicationStatus = "APPLIED"; payload.wfmApprovedAt = now; payload.wfmApprovedById = userId;
        nextStatus = "APROVADO"; action = "Aprovação final WFM e atualização dos dois cronogramas"; recipients.push(supervisorId);
      }
    }
    const saved = await tx.request.update({ where: { id }, data: { status: nextStatus, payload: payload as unknown as Prisma.InputJsonObject,
      history: { create: { actorId: userId, action, from: request.status, to: nextStatus, reason } }
    }, include });
    await tx.auditLog.create({ data: { actorId: userId, action: decision === "REJECT" ? "RECUSA" : decision === "CANCEL" ? "EDICAO" : "APROVACAO", entity: "Request", entityId: id, reason: action, newValue: { status: nextStatus, stage: payload.stage } } });
    await notify(tx, saved, recipients, `${saved.code}: ${action}. ${reason ?? ""}`);
    return { request: saved, scheduleUpdated: payload.scheduleApplicationStatus === "APPLIED" };
  }, { timeout: 15000 });
}
