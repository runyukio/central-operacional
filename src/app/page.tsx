import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getDefaultPathForRole } from "@/lib/navigation";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  redirect(getDefaultPathForRole(session?.user?.role));
}
