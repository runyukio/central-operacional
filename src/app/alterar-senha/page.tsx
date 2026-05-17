import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { ChangePasswordCard } from "@/components/change-password-card";
import { authOptions } from "@/lib/auth-options";

export default async function ChangePasswordPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_78%_8%,rgba(37,99,235,.12),transparent_28rem),#F6F8FC] p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white">
            <Sparkles className="h-6 w-6" />
          </div>
          <p className="text-xl font-extrabold text-navy-950">Central Operacional</p>
        </div>
        <ChangePasswordCard initialEmail={session.user.email} showEmail={false} forceMode />
      </div>
    </main>
  );
}
