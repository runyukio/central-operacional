import { PerformancePage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function PerformanceRoute() {
  await requireAdminRoute();
  return <PerformancePage />;
}
