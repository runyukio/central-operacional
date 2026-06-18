import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canAccessBilling } from "@/lib/billing-permissions";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";
import { canAccessPathForRole, getDefaultPathForRole } from "@/lib/navigation";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request });
  const pathname = request.nextUrl.pathname;

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = String(token.role ?? "COLABORADOR");
  if (token.mustChangePassword && pathname !== "/alterar-senha") {
    return NextResponse.redirect(new URL("/alterar-senha", request.url));
  }

  if ((pathname === "/billing" || pathname.startsWith("/billing/")) && !canAccessBilling({ id: token.sub, email: token.email, name: token.name })) {
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  if ((pathname === "/financeiro" || pathname.startsWith("/financeiro/") || pathname === "/api/financeiro" || pathname.startsWith("/api/financeiro/")) && !canAccessFinanceiro({ id: token.sub, email: token.email, name: token.name })) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Você não tem permissão para acessar Financeiro.", message: "Você não tem permissão para acessar Financeiro." }, { status: 403 });
    }
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  if (!canAccessPathForRole(pathname, role)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Você não tem permissão para acessar esta página.", message: "Você não tem permissão para acessar esta página." }, { status: 403 });
    }
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/employee-registrations/public|api/realtime/import|cadastro-colaborador|login|_next/static|_next/image|favicon.ico).*)"]
};
