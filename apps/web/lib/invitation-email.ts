import { siteUrl } from "@/lib/site-url";

/**
 * The invitation email, sent through Resend directly.
 *
 * Supabase's SMTP is configured with the same provider (§34), but that sender only carries
 * GoTrue's own mail — confirmations and recoveries. This is our message, with our link, so it
 * goes through Resend's API rather than being contorted into an auth template.
 *
 * **The link is built from configuration, never from a request header.** A `Host` is
 * attacker-controlled and an invitation built from one is a poisoned link — the same trap
 * `lib/site-url.ts` exists to close for confirmations.
 */
export interface InvitationEmail {
  to: string;
  householdName: string;
  invitedBy: string;
  token: string;
}

export type SendOutcome =
  | { sent: true }
  | { sent: false; reason: "not-configured" | "refused"; detail: string };

export const invitationLink = (token: string): string =>
  `${siteUrl()}/invite/${encodeURIComponent(token)}`;

export async function sendInvitationEmail(invitation: InvitationEmail): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.PASHKI_SMTP_SENDER_EMAIL ?? "noreply@pashki.com";
  if (!key) {
    return {
      sent: false,
      reason: "not-configured",
      detail: "RESEND_API_KEY is not set on this deployment",
    };
  }

  const link = invitationLink(invitation.token);
  const household = escapeHtml(invitation.householdName);
  const who = escapeHtml(invitation.invitedBy);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Pashki <${from}>`,
      to: [invitation.to],
      subject: `${invitation.invitedBy} invited you to ${invitation.householdName}`,
      text:
        `${invitation.invitedBy} has invited you to share the recipes in ${invitation.householdName}.\n\n` +
        `Accept: ${link}\n\n` +
        `The link works once and expires in seven days. If you weren't expecting this, ignore it — ` +
        `nothing happens until you follow the link.`,
      html:
        `<p>${who} has invited you to share the recipes in <strong>${household}</strong>.</p>` +
        `<p><a href="${link}">Accept the invitation</a></p>` +
        `<p style="color:#7a7065;font-size:14px">The link works once and expires in seven days. ` +
        `If you weren't expecting this, ignore it — nothing happens until you follow the link.</p>`,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, reason: "refused", detail: `${response.status} ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}

/** A household name is user-supplied and goes into HTML; it is escaped rather than trusted. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
