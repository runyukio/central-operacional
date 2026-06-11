import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  AdditionalRegistrationDataError,
  getOwnAdditionalRegistrationData,
  listAdditionalRegistrationDataTracking,
  saveOwnAdditionalRegistrationData
} from "@/lib/additional-registration-data-service";

const additionalDataSchema = z.object({
  ethnicity: z.string().trim().optional(),
  sexualOrientation: z.string().trim().optional(),
  isPcd: z.string().trim().optional(),
  pcdDisabilityType: z.string().trim().optional(),
  pcdDisabilityOther: z.string().trim().optional(),
  firstJob: z.string().trim().optional(),
  hasTelemarketingExperience: z.string().trim().optional(),
  telemarketingWhere: z.string().trim().optional(),
  pixKeyType: z.string().trim().optional(),
  pixKey: z.string().trim().optional()
});

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("scope") === "tracking") {
      return NextResponse.json(await listAdditionalRegistrationDataTracking(actor, {
        status: url.searchParams.get("status") ?? undefined,
        lob: url.searchParams.get("lob") ?? undefined,
        supervisorId: url.searchParams.get("supervisorId") ?? undefined,
        role: url.searchParams.get("role") ?? undefined,
        skill: url.searchParams.get("skill") ?? undefined,
        wave: url.searchParams.get("wave") ?? undefined,
        search: url.searchParams.get("search") ?? undefined
      }));
    }
    return NextResponse.json(await getOwnAdditionalRegistrationData(actor));
  } catch (error) {
    return additionalDataErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = additionalDataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos.", message: "Dados inválidos.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const actor = await getApiActor();
  try {
    return NextResponse.json(await saveOwnAdditionalRegistrationData(actor, parsed.data));
  } catch (error) {
    return additionalDataErrorResponse(error);
  }
}

function additionalDataErrorResponse(error: unknown) {
  if (error instanceof AdditionalRegistrationDataError) {
    return NextResponse.json({ error: error.message, message: error.message, fields: error.fields ?? {} }, { status: error.status });
  }
  console.error("[employee-additional-data] erro inesperado", error);
  return NextResponse.json({ error: "Não foi possível processar os Dados Cadastrais Adicionais." }, { status: 500 });
}
