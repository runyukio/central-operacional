import { ChatPage } from "@/components/modules";
import { requireAdminRoute } from "@/lib/admin-route";

export default async function ChatRoute() {
  await requireAdminRoute();
  return <ChatPage />;
}
