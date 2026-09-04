type SupabasePasswordResponse = {
  access_token?: string;
  user?: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  error?: string;
  error_description?: string;
};

export function isSupabaseConfigured() {
  if (process.env.USE_LOCAL_DB === "true" || process.env.APP_ENV === "local") return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return false;
  return !/PROJECT_REF|SUPABASE_|ANON_KEY/.test(`${url}${key}`);
}

export async function verifySupabasePassword(email: string, password: string) {
  if (!isSupabaseConfigured()) return null;

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => ({}))) as SupabasePasswordResponse;
  if (!response.ok || !payload.user?.email) {
    return null;
  }

  return {
    id: payload.user.id,
    email: payload.user.email,
    name: String(payload.user.user_metadata?.name ?? payload.user.email.split("@")[0])
  };
}

type SupabaseAdminUser = { id: string; email?: string };

export function isSupabaseAdminConfigured() {
  if (!isSupabaseConfigured()) return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return Boolean(key) && !/SUPABASE_|SERVICE_ROLE_KEY/.test(key);
}

// Keeps Supabase Auth in sync when the same e-mail exists there. The service-role
// credential is used only on the server and is never returned to the browser.
export async function updateSupabasePasswordIfPresent(email: string, password: string) {
  if (!isSupabaseAdminConfigured()) return "NOT_CONFIGURED" as const;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const listUrl = new URL(`${url}/auth/v1/admin/users`);
  listUrl.searchParams.set("filter", email);
  listUrl.searchParams.set("page", "1");
  listUrl.searchParams.set("per_page", "50");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const listed = await fetch(listUrl, { headers, cache: "no-store" });
  if (!listed.ok) throw new Error(`Supabase Auth user lookup failed (${listed.status}).`);
  const payload = await listed.json().catch(() => ({})) as { users?: SupabaseAdminUser[] };
  const user = payload.users?.find((item) => item.email?.trim().toLowerCase() === email.trim().toLowerCase());
  if (!user) return "NOT_FOUND" as const;
  const updated = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: "PUT", headers, body: JSON.stringify({ password }), cache: "no-store"
  });
  if (!updated.ok) throw new Error(`Supabase Auth password update failed (${updated.status}).`);
  return "UPDATED" as const;
}
