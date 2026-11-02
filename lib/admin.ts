import "server-only";

/**
 * Admin access control. The admins come from ADMIN_EMAILS in the
 * deployment's environment: a comma-separated list where each entry is an
 * email or `Name <email>`. Read on the server only, so the addresses are in
 * neither the repository nor any page's JavaScript; a page learns whether its
 * viewer is an admin from /api/auth/admin.
 */

interface Admin {
  email: string;
  name: string;
}

function admins(): Admin[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const named = entry.match(/^(.*)<([^>]+)>$/);
      const email = (named ? named[2] : entry).trim().toLowerCase();
      return { email, name: named?.[1].trim() || email.split("@")[0] };
    });
}

/** The admins' email addresses, in the order configured. */
export function adminEmails(): string[] {
  return admins().map((admin) => admin.email);
}

/** Whether an email is an admin's. */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const wanted = email.trim().toLowerCase();
  return admins().some((admin) => admin.email === wanted);
}

/** An admin's configured name, else the local part of the email. */
export function getAdminName(email: string): string {
  const wanted = email.trim().toLowerCase();
  return admins().find((admin) => admin.email === wanted)?.name ?? email.split("@")[0];
}
