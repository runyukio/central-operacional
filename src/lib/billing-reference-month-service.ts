import {
  BILLING_REFERENCE_MONTH_CONFIG_KEY,
  DEFAULT_BILLING_REFERENCE_MONTH,
  isValidBillingReferenceMonth
} from "@/lib/billing-reference-month";
import { normalizeReferenceMonth } from "@/lib/monthly-advance-service";
import { prisma } from "@/lib/prisma";

export async function getDefaultBillingReferenceMonth() {
  const config = await prisma.systemConfig.findUnique({ where: { key: BILLING_REFERENCE_MONTH_CONFIG_KEY } });
  return isValidBillingReferenceMonth(config?.value) ? config.value : DEFAULT_BILLING_REFERENCE_MONTH;
}

export async function resolveBillingReferenceMonth(input?: string | null) {
  // An explicitly selected historical period always takes precedence.
  return normalizeReferenceMonth(input) || await getDefaultBillingReferenceMonth();
}
