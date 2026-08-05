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

  const isBillingPath = pathname === "/billing" || pathname.startsWith("/billing/");
  if (isBillingPath && !canAccessBilling({ id: token.sub, email: token.email, name: token.name, role })) {
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  if ((pathname === "/financeiro" || pathname.startsWith("/financeiro/") || pathname === "/api/financeiro" || pathname.startsWith("/api/financeiro/")) && !canAccessFinanceiro({ id: token.sub, email: token.email, name: token.name, role })) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Você não tem permissão para acessar Financeiro.", message: "Você não tem permissão para acessar Financeiro." }, { status: 403 });
    }
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  const permissionUser = {
    role,
    email: typeof token.email === "string" ? token.email : null,
    name: typeof token.name === "string" ? token.name : null,
    status: "ACTIVE"
  };

  if (!isBillingPath && !canAccessPathForRole(pathname, permissionUser)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Você não tem permissão para acessar esta página.", message: "Você não tem permissão para acessar esta página." }, { status: 403 });
    }
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/employee-registrations/public|api/realtime/import|api/realtime/cec/import|api/realtime/ai-snapshot|api/realtime-hours/import|api/realtime-hours/agent-snapshot|api/realtime-hours/status|api/realtime-hours/imports|api/performance/import/automated|api/cron/realtime-cec|api/cron/shift-changes-effective|api/cron/ads-executive-report|api/cron/ads-online-productivity-report|api/cron/video-executive-report|cadastro-colaborador|login|_next/static|_next/image|favicon.ico).*)"]
};
