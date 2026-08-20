import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";

export type MoodInput = {
  date?: string;
  moodScore: number;
  comment?: string;
};

export type MoodGroupSummary = {
  label: string;
  responses: number;
  average: number;
  interpretation: string;
};

export function moodLabel(score: number) {
  if (score <= 2) return "Triste";
  if (score >= 4) return "Feliz";
  return "Normal";
}

export function moodInterpretation(average: number, responses: number) {
  if (!responses) return "Sem respostas no período";
  if (average <= 2) return "Crítico";
  if (average <= 3) return "Atenção";
  if (average <= 4) return "Estável";
  return "Positivo";
}

const saoPauloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function parseMoodDate(value?: string) {
  const raw = value?.trim() || saoPauloDateFormatter.format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveMoodActor(actor: Actor) {
  const email = actor.email.toLowerCase().trim();
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { employeeProfile: true } });
  if (!user) return null;
  if (user.employeeProfile) return { user, employee: user.employeeProfile };

  const approvedRegistration = await prisma.employeeRegistrationRequest.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    orderBy: { submittedAt: "desc" },
    select: { createdEmployeeProfileId: true }
  });
  if (!approvedRegistration?.createdEmployeeProfileId) return null;

  const employee = await prisma.employeeProfile.findFirst({
    where: { id: approvedRegistration.createdEmployeeProfileId, deletedAt: null }
  });
  return employee ? { user, employee } : null;
}

export async function getOwnMood(actor: Actor, dateValue?: string) {
  const actorMood = await resolveMoodActor(actor);
  if (!actorMood) return { error: "Usuário sem cadastro de parceiro vinculado." };
  const date = parseMoodDate(dateValue);
  if (!date) return { error: "Data inválida." };
  const record = await prisma.employeeMoodRecord.findUnique({
    where: { employeeId_date: { employeeId: actorMood.employee.id, date } }
  });
  return {
    data: record ? {
      id: record.id,
      date: record.date.toISOString().slice(0, 10),
      moodScore: record.moodScore,
      moodLabel: moodLabel(record.moodScore),
      comment: record.comment ?? ""
    } : null
  };
}

export async function submitOwnMood(actor: Actor, input: MoodInput) {
  const actorMood = await resolveMoodActor(actor);
  if (!actorMood) return { error: "Usuário sem cadastro de parceiro vinculado." };
  const date = parseMoodDate(input.date);
  if (!date) return { error: "Data inválida." };
  const moodScore = Number(input.moodScore);
  if (!Number.isInteger(moodScore) || moodScore < 1 || moodScore > 5) return { error: "Humor inválido." };
  const comment = input.comment?.trim() || null;
  const record = await prisma.$transaction(async (tx) => {
    const saved = await tx.employeeMoodRecord.upsert({
      where: { employeeId_date: { employeeId: actorMood.employee.id, date } },
      update: { moodScore, moodLabel: moodLabel(moodScore), comment },
      create: {
        employeeId: actorMood.employee.id,
        userId: actorMood.user.id,
        date,
        moodScore,
        moodLabel: moodLabel(moodScore),
        comment
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: actorMood.user.id,
        action: "CRIACAO",
        entity: "EmployeeMoodRecord",
        entityId: saved.id,
        reason: "Humor operacional registrado no Meu Cronograma",
        newValue: { date: date.toISOString().slice(0, 10), moodScore }
      }
    });
    return saved;
  });
  return {
    data: {
      id: record.id,
      date: record.date.toISOString().slice(0, 10),
      moodScore: record.moodScore,
      moodLabel: moodLabel(record.moodScore),
      comment: record.comment ?? ""
    },
    message: "Humor registrado com sucesso."
  };
}

export function moodGroupSummary(records: Array<{ moodScore: number; employee: { lob?: { name: string } | null; supervisor?: { fullName: string } | null; roleTitle?: string | null } }>, groupBy: "lob" | "supervisor" | "roleTitle"): MoodGroupSummary[] {
  const grouped = new Map<string, { label: string; responses: number; scoreTotal: number; average: number; interpretation: string }>();
  records.forEach((record) => {
    const label =
      groupBy === "lob"
        ? record.employee.lob?.name ?? "Sem LOB"
        : groupBy === "supervisor"
          ? record.employee.supervisor?.fullName ?? "Sem supervisor"
          : record.employee.roleTitle ?? "Sem cargo";
    const current = grouped.get(label) ?? { label, responses: 0, scoreTotal: 0, average: 0, interpretation: "Sem respostas no período" };
    current.responses += 1;
    current.scoreTotal += record.moodScore;
    current.average = Number((current.scoreTotal / current.responses).toFixed(2));
    current.interpretation = moodInterpretation(current.average, current.responses);
    grouped.set(label, current);
  });
  return Array.from(grouped.values())
    .map(({ scoreTotal: _scoreTotal, ...item }) => item)
    .sort((a, b) => b.responses - a.responses || a.label.localeCompare(b.label, "pt-BR"));
}
