import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { hasQualityWeeklyAccess, QualityWeeklyError } from "./access";

export async function requireQualityWeeklyUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new QualityWeeklyError("Sign in to the operational site to continue.", 401);
  if (session.user.mustChangePassword) throw new QualityWeeklyError("Update your temporary password before continuing.", 403);
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: {
    id: true, email: true, name: true, status: true, deletedAt: true, role: { select: { name: true } },
    employeeProfile: { select: { wbLogin: true, deletedAt: true } }
  } });
  if (!user || !hasQualityWeeklyAccess({ ...user, role: user.role.name,
    wbLogin: user.employeeProfile?.deletedAt ? null : user.employeeProfile?.wbLogin })) {
    throw new QualityWeeklyError("Access is restricted to active ADM/WFM users.", 403);
  }
  return { id: user.id, name: user.name, email: user.email };
}
