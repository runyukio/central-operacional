import { NextResponse } from "next/server";

const inactiveResponse = () => NextResponse.json({ error: "Este módulo está temporariamente inativo." }, { status: 410 });

export async function GET() {
  return inactiveResponse();
}

export async function PATCH() {
  return inactiveResponse();
}
