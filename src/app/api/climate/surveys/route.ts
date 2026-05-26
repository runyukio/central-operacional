import { NextResponse } from "next/server";

export async function GET() {
  return inactiveClimateResponse();
}

export async function POST() {
  return inactiveClimateResponse();
}

export async function PATCH() {
  return inactiveClimateResponse();
}

function inactiveClimateResponse() {
  return NextResponse.json(
    { error: "Este módulo está temporariamente inativo.", message: "Este módulo está temporariamente inativo." },
    { status: 403 }
  );
}
