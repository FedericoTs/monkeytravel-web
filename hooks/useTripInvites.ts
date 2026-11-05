"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import type { CollaboratorRole, TripCollaborator } from "@/types";

/**
 * The share window's invite tab: who is on the trip, an invite link or an emailed
 * invite, changing someone's role and removing them. The window holds this, not the
 * tab, so moving to the other tab keeps what was typed and the link that was made.
 */
export function useTripInvites(tripId: string) {
  const t = useTranslations("common");
  const ts = (key: string, params?: Record<string, string | number>) => t(`share.${key}`, params);
  const { addToast } = useToast();

  // Editor by default: an invite to plan together is the one people accept; a
  // voter or viewer invite rarely is.
  const [selectedRole, setSelectedRole] = useState<Exclude<CollaboratorRole, "owner">>("editor");
  // The role, email and single-link controls sit behind "More invite
  // options", under the named co-planner invites.
  const [showMoreInviteOptions, setShowMoreInviteOptions] = useState(false);
  const [collaborators, setCollaborators] = useState<TripCollaborator[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);

  // Email-invite state. Empty recipient = legacy shareable-link path.
  // Filled = single-recipient invite via the new /api/trips/[id]/invites
  // recipientEmail parameter (see app/api/trips/[id]/invites/route.ts).
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailOutcome, setEmailOutcome] = useState<string | null>(null);

  const fetchCollaborators = useCallback(async () => {
    setIsLoadingCollaborators(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/collaborators`);
      if (response.ok) {
        const data = await response.json();
        setCollaborators(data.collaborators || []);
      }
    } catch (error) {
      console.error("Failed to fetch collaborators:", error);
    } finally {
      setIsLoadingCollaborators(false);
    }
  }, [tripId]);

  // The window opened: the team afresh, and no link from last time.
  const reopen = useCallback(() => {
    setInviteUrl(null);
    setInviteCopied(false);
    void fetchCollaborators();
  }, [fetchCollaborators]);

  // Generate invite link
  const handleGenerateInvite = async () => {
    setIsGeneratingInvite(true);
    setEmailOutcome(null);

    // Build the request body. When emailRecipient is set, the server-side
    // path forces single-use, sends an email (or skip-logs it if Resend
    // isn't configured), and returns emailOutcome on the response. Empty
    // recipient = legacy shareable-link behavior.
    const trimmedEmail = emailRecipient.trim();
    const trimmedMessage = emailMessage.trim();
    const body: Record<string, unknown> = { role: selectedRole };
    if (trimmedEmail) body.recipientEmail = trimmedEmail;
    if (trimmedMessage) body.message = trimmedMessage;

    try {
      const response = await fetch(`/api/trips/${tripId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        setInviteUrl(data.invite.inviteUrl);
        if (data.emailOutcome) {
          setEmailOutcome(data.emailOutcome);
          if (data.emailOutcome === "sent") {
            addToast(ts("inviteEmail.toastSent", { email: trimmedEmail }), "success");
          } else if (data.emailOutcome === "skipped_no_key") {
            addToast(ts("inviteEmail.toastNoKey"), "info");
          } else if (data.emailOutcome === "skipped_suppressed") {
            addToast(ts("inviteEmail.toastSuppressed"), "warning");
          } else if (data.emailOutcome === "failed") {
            addToast(ts("inviteEmail.toastFailed"), "warning");
          } else {
            addToast(ts("toast.inviteCreated"), "success");
          }
        } else {
          addToast(ts("toast.inviteCreated"), "success");
        }
        // Reset the email fields after a successful send so the user
        // can either invite someone else or use the link they got back.
        setEmailRecipient("");
        setEmailMessage("");
      } else {
        const error = await response.json();
        console.error("Failed to generate invite:", error);
        // The route explains in English for its logs; with an address typed, a 400 is that address.
        addToast(ts(response.status === 400 && trimmedEmail ? "toast.inviteEmailInvalid" : "toast.inviteCreateFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to generate invite:", error);
      addToast(ts("toast.networkError"), "error");
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  // Copy invite URL with fallback for older browsers
  const handleCopyInviteUrl = async () => {
    if (!inviteUrl) return;
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteUrl);
      } else {
        // Fallback for non-secure contexts or older browsers
        const textArea = document.createElement("textarea");
        textArea.value = inviteUrl;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
      addToast(ts("toast.collaborationCopied"), "success");
    } catch (error) {
      console.error("Failed to copy:", error);
      addToast(ts("toast.copyFailed"), "error");
    }
  };

  // Removing someone or lowering their role switches off the trip's open
  // invite links on the server, so the link on screen no longer works: clear
  // it and say so.
  const noteInvitesReset = (count: number | undefined) => {
    if (!count) return;
    setInviteUrl(null);
    addToast(ts("toast.linksReset"), "info");
  };

  // Update collaborator role
  const handleRoleChange = async (userId: string, newRole: CollaboratorRole) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/collaborators/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as { invitesReset?: number } | null;
        await fetchCollaborators();
        addToast(ts("toast.roleUpdated", { role: t(`roles.${newRole}.label`) }), "success");
        noteInvitesReset(data?.invitesReset);
      } else {
        addToast(ts("toast.roleUpdateFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to update role:", error);
      addToast(ts("toast.roleUpdateFailed"), "error");
    }
  };

  // Remove collaborator
  const handleRemoveCollaborator = async (userId: string) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/collaborators/${userId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        const data = (await response.json().catch(() => null)) as { invitesReset?: number } | null;
        await fetchCollaborators();
        addToast(ts("toast.memberRemoved"), "success");
        noteInvitesReset(data?.invitesReset);
      } else {
        addToast(ts("toast.memberRemoveFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to remove collaborator:", error);
      addToast(ts("toast.memberRemoveFailed"), "error");
    }
  };

  return {
    selectedRole,
    setSelectedRole,
    showMoreInviteOptions,
    setShowMoreInviteOptions,
    collaborators,
    isLoadingCollaborators,
    inviteUrl,
    setInviteUrl,
    inviteCopied,
    isGeneratingInvite,
    emailRecipient,
    setEmailRecipient,
    emailMessage,
    setEmailMessage,
    emailOutcome,
    reopen,
    handleGenerateInvite,
    handleCopyInviteUrl,
    handleRoleChange,
    handleRemoveCollaborator,
  };
}
