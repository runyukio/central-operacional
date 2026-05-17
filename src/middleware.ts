import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getDefaultPathForRole, navItems } from "@/lib/navigation";

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

  const protectedItem = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  if (protectedItem && !protectedItem.roles.includes(role as never)) {
    return NextResponse.redirect(new URL(getDefaultPathForRole(role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/employee-registrations/public|cadastro-colaborador|login|_next/static|_next/image|favicon.ico).*)"]
};
