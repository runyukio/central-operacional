import bcrypt from "bcryptjs";
import { isSupabaseAdminConfigured, isSupabaseConfigured, updateSupabasePasswordIfPresent, verifySupabasePassword } from "@/lib/supabase-auth";

type PasswordIdentity = {
  email: string; passwordHash: string;
  passwordChangedAt?: Date | null; lastPasswordResetAt?: Date | null;
};

export const passwordCredentialProviders = {
  verifyExternal: verifySupabasePassword,
  updateExternal: updateSupabasePasswordIfPresent,
  isExternalConfigured: isSupabaseConfigured,
  isExternalAdminConfigured: isSupabaseAdminConfigured
};

export function hasLocalPasswordAuthority(user: PasswordIdentity) {
  return Boolean(user.passwordChangedAt || user.lastPasswordResetAt);
}

export async function verifyAccountPassword(user: PasswordIdentity, password: string) {
  if (await bcrypt.compare(password, user.passwordHash)) return true;
  // Legacy dual-provider accounts can migrate once. After a local change/reset,
  // the local credential is authoritative even if external synchronization fails.
  if (hasLocalPasswordAuthority(user)) return false;
  return Boolean(await passwordCredentialProviders.verifyExternal(user.email, password));
}

export function assertPasswordSyncConfigured() {
  if (passwordCredentialProviders.isExternalConfigured() && !passwordCredentialProviders.isExternalAdminConfigured()) {
    throw new Error("Sincronização de senha indisponível. Contate o administrador.");
  }
}

export async function synchronizeUserPassword(input: {
  email: string; password: string; persistLocal: (passwordHash: string) => Promise<unknown>;
}) {
  assertPasswordSyncConfigured();
  const hash = await bcrypt.hash(input.password, 10);
  // Persist the authoritative credential and revocation timestamp first. An
  // external outage must never resurrect the old password in this application.
  await input.persistLocal(hash);
  try {
    return await passwordCredentialProviders.updateExternal(input.email, input.password);
  } catch {
    return "LOCAL_SAVED_EXTERNAL_PENDING" as const;
  }
}
