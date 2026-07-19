import { roleHasCapability } from "@/lib/access-control";

type FinanceiroIdentity = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
};

export function canAccessFinanceiro(user?: FinanceiroIdentity | null) {
  return Boolean(user && roleHasCapability(user.role, "FINANCE_VIEW"));
}

export function canManageFinanceiro(user?: FinanceiroIdentity | null) {
  return Boolean(user && roleHasCapability(user.role, "FINANCE_MANAGE"));
}
