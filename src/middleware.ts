import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canAccessBilling } from "@/lib/billing-permissions";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";
import { canAccessPathForRole, getDefaultPathForRole } from "@/lib/navigation";
import { validateCurrentSessionToken } from "@/lib/session-validation";
import { isRetiredFeaturePath } from "@/lib/retired-features";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isRetiredFeaturePath(pathname)) {
    const message = "A Rifa foi encerrada e removida do site.";
    const headers = { "Cache-Control": "no-store" };
    return pathname.startsWith("/api/")
      ? NextResponse.json({ success: false, error: message, message }, { status: 410, headers })
      : new NextResponse(message, { status: 410, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const originalToken = await getToken({ req: request });
  const token = originalToken ? await validateCurrentSessionToken(originalToken) : null;

  if (!token || token.authInvalid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Sessão expirada ou revogada. Entre novamente.", message: "Sessão expirada ou revogada. Entre novamente." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname === "/weekly-quality-report" ? pathname + request.nextUrl.search : pathname);
    if (originalToken) loginUrl.searchParams.set("reason", "session-expired");
    return NextResponse.redirect(loginUrl);
  }

  const role = String(token.role ?? "COLABORADOR");
  if (token.mustChangePassword && pathname !== "/alterar-senha") {
    return NextResponse.redirect(new URL("/alterar-senha", request.url));
  }

  const isBillingPath = pathname === "/billing" || pathname.startsWith("/billing/");
  if (isBillingPath && !canAccessBilling({
    id: token.sub,
    email: token.email,
    name: token.name,
    role,
    roleTitle: typeof token.roleTitle === "string" ? token.roleTitle : null,
    jobTitle: typeof token.jobTitle === "string" ? token.jobTitle : null
  })) {
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
    roleTitle: typeof token.roleTitle === "string" ? token.roleTitle : null,
    jobTitle: typeof token.jobTitle === "string" ? token.jobTitle : null,
    lob: typeof token.lob === "string" ? token.lob : null,
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
  runtime: "nodejs",
  matcher: ["/((?!api/auth|api/employee-registrations/public|api/realtime/import|api/realtime/cec/import|api/realtime/ai-snapshot|api/realtime-hours/import|api/realtime-hours/agent-snapshot|api/realtime-hours/status|api/realtime-hours/imports|api/performance/import/automated|api/cron/realtime-cycle-monitor|api/cron/realtime-hours-archive|api/cron/realtime-cec|api/cron/shift-changes-effective|api/cron/ads-executive-report|api/cron/ads-online-productivity-report|api/cron/ads-productivity-alerts|api/cron/tns-online-productivity-report|api/cron/ads-backlog-hourly-report|api/cron/video-executive-report|cadastro-colaborador|login|_next/static|_next/image|favicon.ico).*)"]
};
