import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Este módulo está temporariamente inativo.", message: "Este módulo está temporariamente inativo." },
    { status: 403 }
  );
}
