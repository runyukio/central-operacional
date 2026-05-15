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
