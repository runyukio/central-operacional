type BillingIdentity = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
};

const DEFAULT_ALLOWED_EMAILS = ["runyukio@gmail.com", "admin@central.com"];

export function canAccessBilling(user?: BillingIdentity | null) {
  if (!user) return false;
  const allowedEmails = parseAllowlist(process.env.BILLING_ALLOWED_EMAILS, DEFAULT_ALLOWED_EMAILS);
  const allowedUserIds = parseAllowlist(process.env.BILLING_ALLOWED_USER_IDS);
  const email = normalize(user.email);
  const id = normalize(user.id);
  return Boolean((email && allowedEmails.has(email)) || (id && allowedUserIds.has(id)));
}

function parseAllowlist(raw?: string, fallback: string[] = []) {
  const values = raw && raw.trim() ? raw.split(",") : fallback;
  return new Set(values.map(normalize).filter(Boolean));
}

function normalize(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}
