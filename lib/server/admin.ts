type AdminUser = {
  email?: string | null;
};

export const ADMIN_USAGE_SENTINEL = -1;

export function parseAdminEmails(value = process.env.ADMIN_EMAILS) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminUser(user: AdminUser | null | undefined) {
  const email = user?.email?.trim().toLowerCase();

  if (!email) return false;

  return parseAdminEmails().has(email);
}
