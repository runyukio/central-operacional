import { roleHasCapability } from "@/lib/access-control";

type BillingIdentity = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
};

export function canAccessBilling(user?: BillingIdentity | null) {
  return Boolean(user && roleHasCapability(user.role, "BILLING_VIEW"));
}

export function canManageBilling(user?: BillingIdentity | null) {
  return Boolean(user && roleHasCapability(user.role, "BILLING_MANAGE"));
}
