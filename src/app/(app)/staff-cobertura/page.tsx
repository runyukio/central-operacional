import { StaffCoveragePage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function StaffCoberturaRoute() {
  await requireAdminRoute();
  return <StaffCoveragePage />;
}
