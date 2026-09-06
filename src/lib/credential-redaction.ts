const secretFields = new Set(["password", "passwordhash", "currentpassword", "newpassword", "confirmpassword", "securityanswerhash", "answer", "secret", "token", "accesstoken", "refreshtoken"]);

export function redactCredentialFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentialFields);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    secretFields.has(key.replace(/[_-]/g, "").toLowerCase()) ? "protected" : redactCredentialFields(item)
  ]));
}
