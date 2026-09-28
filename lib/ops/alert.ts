import { sendEmail } from "@/lib/email/client";
import { ADMIN_EMAILS } from "@/lib/admin";

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

/**
 * Email the owner about an operational problem, and log it as an error so it
 * also appears in the runtime error view. Returns whether the email was sent.
 */
export async function sendOpsAlert(subject: string, lines: string[]): Promise<boolean> {
  const to = process.env.OPS_ALERT_EMAIL || ADMIN_EMAILS[0];
  const text = lines.join("\n");
  console.error(`[ops-alert] ${subject}\n${text}`);
  const result = await sendEmail({
    to,
    subject: `[MonkeyTravel ops] ${subject}`,
    text,
    html: `<pre style="font:14px/1.5 monospace">${escapeHtml(text)}</pre>`,
    tags: [{ name: "kind", value: "ops_alert" }],
  });
  if (!result.ok) console.error("[ops-alert] email failed:", result.error);
  return result.ok;
}
