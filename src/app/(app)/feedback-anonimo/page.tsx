import { AnonymousFeedbackPage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function FeedbackAnonimoRoute() {
  await requireAdminRoute();
  return <AnonymousFeedbackPage />;
}
