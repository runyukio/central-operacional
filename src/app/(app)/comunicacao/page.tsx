import { redirect } from "next/navigation";

import { requireAdminRoute } from "@/lib/admin-route";

export default async function ComunicacaoRoute() {
  await requireAdminRoute();
  redirect("/mural");
}
