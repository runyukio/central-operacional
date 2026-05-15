import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { resetEmployeeUserPassword } from "@/lib/employee-service";

const schema = z.object({
  employeeId: z.string().min(1),
  password: z.string().min(8, "A nova senha deve ter pelo menos 8 caracteres."),
  confirmPassword: z.string().min(1, "Confirme a nova senha.")
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
  message: "A confirmação de senha não confere."
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para resetar senha.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const actor = await getApiActor();
  const result = await resetEmployeeUserPassword(actor, parsed.data);
  if ("error" in result) return NextResponse.json(result, { status: 403 });

  return NextResponse.json(result);
}
