import { TokensPage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function TokensRoute() {
  await requireAdminRoute();
  return <TokensPage />;
}
