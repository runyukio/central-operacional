import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { getActorFromSession } from "@/lib/mock-db";

export async function getApiActor() {
  return getActorFromSession(await getServerSession(authOptions));
}
