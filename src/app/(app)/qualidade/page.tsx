import { QualityPage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function QualidadeRoute() {
  await requireAdminRoute();
  return <QualityPage />;
}
