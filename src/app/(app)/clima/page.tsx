import { ClimatePage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function ClimaRoute() {
  await requireAdminRoute();
  return <ClimatePage />;
}
