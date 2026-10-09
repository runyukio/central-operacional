import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { prisma } from "@/lib/prisma";
import { listPairedSwapPartners, PairedSwapError } from "@/lib/paired-day-off-service";

export async function GET() {
  const actor = await getApiActor();
  const user = await prisma.user.findUnique({ where: { email: actor.email }, select: { id: true, status: true } });
  if (!user || user.status !== "ACTIVE") return NextResponse.json({ error: "Usuário ativo não encontrado." }, { status: 403 });
  try {
    return NextResponse.json({ data: await listPairedSwapPartners(user.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PairedSwapError ? error.message : "Não foi possível consultar os parceiros elegíveis." }, { status: error instanceof PairedSwapError ? 400 : 500 });
  }
}
