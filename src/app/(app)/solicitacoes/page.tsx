import { redirect } from "next/navigation";

type SolicitacoesRouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SolicitacoesRoute({ searchParams }: SolicitacoesRouteProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
      return;
    }
    if (value) params.set(key, value);
  });

  const queryString = params.toString();
  redirect(`/esteiras${queryString ? `?${queryString}` : ""}`);
}
