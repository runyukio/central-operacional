import { redirect } from "next/navigation";
import { getApiActor } from "@/lib/api-actor";
import { getMeuEspacoScope } from "@/lib/meu-espaco-scope";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { MeuEspacoPage } from "@/components/meu-espaco/page";

export default async function Page() {
  const actor = await getApiActor();
  try { await getMeuEspacoScope(actor); }
  catch (error) { if (error instanceof MeuEspacoError && error.status === 403) redirect("/meu-perfil"); throw error; }
  return <MeuEspacoPage />;
}
