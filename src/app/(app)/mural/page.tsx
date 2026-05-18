import { MuralPage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function MuralRoute() {
  await requireAdminRoute();
  return <MuralPage />;
}
