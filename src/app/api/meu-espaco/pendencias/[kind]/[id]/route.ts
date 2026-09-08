import { z } from "zod";
import { getApiActor } from "@/lib/api-actor";
import { getMeuEspacoScope } from "@/lib/meu-espaco-scope";
import { getSpacePendingHistory, respondSpacePending } from "@/lib/meu-espaco-pending-service";
import { spaceApiError, spaceJson } from "@/lib/meu-espaco-api";
import { MeuEspacoError } from "@/lib/meu-espaco-access";

const answer = z.object({ justification: z.string().trim().min(1).max(10000), reason: z.string().trim().max(160).optional(),
  reasonCategory: z.enum(["Cronograma", "Operacional", "Saúde", "Infraestrutura", "Equipamentos", "Internet", "Outros"]).optional(),
  evidenceUrl: z.union([z.literal(""), z.string().url().max(2000).refine((value) => /^https?:\/\//i.test(value))]).optional() }).strict();
type Context = { params: Promise<{ kind: string; id: string }> };
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: Context) {
  const actor = await getApiActor();
  try {
    const { kind, id } = await context.params;
    const scope = await getMeuEspacoScope(actor, new URL(request.url).searchParams.get("supervisorId") || undefined);
    return spaceJson(await getSpacePendingHistory(scope, kind, id));
  } catch (error) { return spaceApiError(error); }
}
export async function POST(request: Request, context: Context) {
  const actor = await getApiActor();
  try {
    const { kind, id } = await context.params;
    const scope = await getMeuEspacoScope(actor, new URL(request.url).searchParams.get("supervisorId") || undefined);
    const parsed = answer.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new MeuEspacoError("Preencha a descrição e revise o motivo e o link da evidência.");
    return spaceJson(await respondSpacePending(scope, kind, id, parsed.data));
  } catch (error) { return spaceApiError(error); }
}
