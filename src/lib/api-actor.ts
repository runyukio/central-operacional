import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { getActorFromSession } from "@/lib/mock-db";

export async function getApiActor() {
  const session = await getServerSession(authOptions);
  // Middleware returns 401 for protected API paths. This also fails closed for
  // integration/auth routes deliberately excluded from its matcher.
  if (!session?.user?.email) redirect("/login?reason=session-expired");
  if (session.user.mustChangePassword) redirect("/alterar-senha");
  return getActorFromSession(session);
}
