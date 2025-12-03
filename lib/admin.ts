/**
 * Admin access control utility
 * Only whitelisted emails can access the admin dashboard
 */

// Whitelisted admin emails - ONLY these users can access /admin
export const ADMIN_EMAILS = [
  "federicosciuca@gmail.com",
  "azzolina.francesca@gmail.com",
  "marinoenrico3@gmail.com",
] as const;

export type AdminEmail = (typeof ADMIN_EMAILS)[number];

/**
 * Check if an email is an admin
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase() as AdminEmail);
}

/**
 * Get admin display name from email
 */
export function getAdminName(email: string): string {
  const names: Record<string, string> = {
    "federicosciuca@gmail.com": "Federico",
    "azzolina.francesca@gmail.com": "Francesca",
    "marinoenrico3@gmail.com": "Enrico",
  };
  return names[email.toLowerCase()] || email.split("@")[0];
}
