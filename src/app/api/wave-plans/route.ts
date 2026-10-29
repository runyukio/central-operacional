import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-actor";
import { createNotFoundError, createPermissionError, createServerError, createValidationError, errorResponse, mapZodError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { isWaveDate, wavePlanPermissions, wavePlanSchema } from "@/lib/wave-planning";

export const dynamic = "force-dynamic";
const versionSchema = z.object({ id: z.string().min(1), updatedAt: z.string().datetime() });

async function access() {
  const actor = await getApiActor();
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
  return { actor, ...wavePlanPermissions({ role: user?.role.name, status: user?.status ?? "INACTIVE" }) };
}

export async function GET(request: Request) {
  const { canView, canManage } = await access();
  if (!canView) return errorResponse(createPermissionError());
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const start = `${month}-01`;
  if (!/^\d{4}-\d{2}$/.test(month) || !isWaveDate(start)) return errorResponse(createValidationError({ month: "Mês inválido." }));
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  try {
    const [rows, lobs] = await Promise.all([
      prisma.wavePlan.findMany({ where: { trainingStartDate: { lt: end }, goLiveDate: { gte: new Date(start) } }, include: { lob: true }, orderBy: [{ trainingStartDate: "asc" }, { name: "asc" }] }),
      prisma.lob.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    ]);
    return NextResponse.json({ data: rows.map((row) => ({ id: row.id, name: row.name, lobId: row.lobId, lob: row.lob.name, headcount: row.headcount, notes: row.notes, trainingStartDate: row.trainingStartDate.toISOString().slice(0, 10), nestingStartDate: row.nestingStartDate.toISOString().slice(0, 10), goLiveDate: row.goLiveDate.toISOString().slice(0, 10), updatedAt: row.updatedAt.toISOString() })), lobs, canManage });
  } catch (error) { return errorResponse(createServerError(error, "Não foi possível carregar o calendário de waves.")); }
}

async function save(request: Request, editing: boolean) {
  const { actor, canView, canManage } = await access();
  if (!canView || !canManage) return errorResponse(createPermissionError());
  const body: unknown = await request.json().catch(() => null);
  const parsed = wavePlanSchema.safeParse(body);
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  const version = versionSchema.safeParse(body);
  if (editing && !version.success) return errorResponse(createValidationError({ id: "Wave ou versão inválida. Recarregue o calendário." }));
  try {
    if (!await prisma.lob.findUnique({ where: { id: parsed.data.lobId }, select: { id: true } })) return errorResponse(createValidationError({ lobId: "LOB não encontrada." }));
    const data = { ...parsed.data, trainingStartDate: new Date(parsed.data.trainingStartDate), nestingStartDate: new Date(parsed.data.nestingStartDate), goLiveDate: new Date(parsed.data.goLiveDate) };
    if (editing && version.success) {
      const result = await prisma.wavePlan.updateMany({ where: { id: version.data.id, updatedAt: new Date(version.data.updatedAt) }, data });
      if (!result.count) return NextResponse.json({ error: "Esta wave foi alterada ou excluída. Recarregue o calendário antes de editar." }, { status: 409 });
    } else {
      await prisma.wavePlan.create({ data: { ...data, createdBy: actor.email } });
    }
    return NextResponse.json({ success: true });
  } catch (error) { return errorResponse(createServerError(error, "Não foi possível salvar a wave.")); }
}
export async function POST(request: Request) { return save(request, false); }
export async function PUT(request: Request) { return save(request, true); }

export async function DELETE(request: Request) {
  const { canView, canManage } = await access();
  if (!canView || !canManage) return errorResponse(createPermissionError());
  const parsed = versionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(mapZodError(parsed.error));
  try {
    const result = await prisma.wavePlan.deleteMany({ where: { id: parsed.data.id, updatedAt: new Date(parsed.data.updatedAt) } });
    if (!result.count) return errorResponse(createNotFoundError("Esta wave foi alterada ou excluída. Recarregue o calendário."), 409);
    return NextResponse.json({ success: true });
  } catch (error) { return errorResponse(createServerError(error, "Não foi possível excluir a wave.")); }
}
