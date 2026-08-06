import { roleHasCapability } from "@/lib/access-control";
import { normalizeComparableJobTitle } from "@/lib/job-title-normalization";

type BillingIdentity = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  roleTitle?: string | null;
  jobTitle?: string | null;
};

export function canAccessBilling(user?: BillingIdentity | null) {
  return Boolean(user && (roleHasCapability(user.role, "BILLING_VIEW") || hasFinanceIdentity(user)));
}

export function canManageBilling(user?: BillingIdentity | null) {
  return Boolean(user && roleHasCapability(user.role, "BILLING_MANAGE"));
}

export function canManageBillingPaymentStatus(user?: BillingIdentity | null) {
  return Boolean(user && (canManageBilling(user) || hasFinanceIdentity(user)));
}

function hasFinanceIdentity(user: BillingIdentity) {
  return normalizeComparableJobTitle(user.role) === "financeiro"
    || normalizeComparableJobTitle(user.roleTitle || user.jobTitle) === "financeiro";
}
