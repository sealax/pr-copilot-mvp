type AdminUser = {
  email?: string | null;
};

export const ADMIN_USAGE_SENTINEL = -1;

export function normalizeAdminEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

export function isAdminConfigPresent(value = process.env.ADMIN_EMAILS) {
  return Boolean(value?.trim());
}

export function parseAdminEmails(value = process.env.ADMIN_EMAILS) {
  return new Set(
    (value ?? "")
      .split(",")
      .map(normalizeAdminEmail)
      .filter(Boolean)
  );
}

export function isAdminUser(user: AdminUser | null | undefined) {
  const email = normalizeAdminEmail(user?.email);

  if (!email) return false;

  return parseAdminEmails().has(email);
}
