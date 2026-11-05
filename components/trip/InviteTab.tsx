"use client";

import { Check, Copy, Mail, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { CollaboratorRow } from "@/components/collaboration/CollaboratorRow";
import { RoleSelector } from "@/components/collaboration/RoleSelector";
import CoPlannerInvites from "@/components/trip/CoPlannerInvites";
import { Spinner } from "@/components/ui/Spinner";
import type { useTripInvites } from "@/hooks/useTripInvites";
import { cn } from "@/lib/utils";

/** The share window's invite tab; its state is the window's (hooks/useTripInvites.ts). */
export default function InviteTab({
  tripId,
  tripTitle,
  invites,
}: {
  tripId: string;
  tripTitle: string;
  invites: ReturnType<typeof useTripInvites>;
}) {
  const t = useTranslations("common");
  const ts = (key: string, params?: Record<string, string | number>) => t(`share.${key}`, params);
  const tb = (key: string) => t(`buttons.${key}`);
  // `canManage` compares the current user with the owner, which shows the role
  // dropdown and the remove button.
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const {
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
    handleGenerateInvite,
    handleCopyInviteUrl,
    handleRoleChange,
    handleRemoveCollaborator,
  } = invites;

  return (
    <div className="space-y-6">
      <CoPlannerInvites tripId={tripId} tripTitle={tripTitle} surface="invite_tab" />

      <button
        type="button"
        onClick={() => setShowMoreInviteOptions((open) => !open)}
        aria-expanded={showMoreInviteOptions}
        className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
      >
        {ts("coplanners.moreOptions")}
      </button>

      {showMoreInviteOptions && (
        <>
          {/* Context hint */}
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
            <UserPlus className="w-4 h-4 text-[var(--primary-ink)] flex-shrink-0" />
            <p className="text-xs text-blue-700">
              <span className="font-medium">{ts("invite.collaborateLabel")}:</span> {ts("invite.collaborateHint")}
            </p>
          </div>

          {/* Role Selection */}
          <RoleSelector selectedRole={selectedRole} onRoleChange={setSelectedRole} disabled={isGeneratingInvite} />

          {/* Optional email invite fields — leave blank for a
              shareable-link invite (legacy behavior). Filling
              these turns it into a single-recipient email send
              via the /api/trips/[id]/invites recipientEmail param. */}
          <div className="space-y-3">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                {ts("inviteEmail.sendTo")}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder="friend@example.com"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  disabled={isGeneratingInvite}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{ts("inviteEmail.leaveBlank")}</p>
            </div>
            {emailRecipient.trim() && (
              <div>
                <label htmlFor="invite-message" className="block text-sm font-medium text-slate-700 mb-1.5">
                  {ts("inviteEmail.noteLabel")}
                </label>
                <textarea
                  id="invite-message"
                  rows={3}
                  maxLength={500}
                  placeholder={ts("inviteEmail.notePlaceholder")}
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  disabled={isGeneratingInvite}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-colors resize-none"
                />
                <p className="text-xs text-slate-500 mt-1 text-right">{emailMessage.length}/500</p>
              </div>
            )}
          </div>

          {/* Generate Invite */}
          {!inviteUrl ? (
            <button
              onClick={handleGenerateInvite}
              disabled={isGeneratingInvite}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
            >
              {isGeneratingInvite ? (
                <>
                  <Spinner className="w-5 h-5" />
                  {ts("invite.generating")}
                </>
              ) : emailRecipient.trim() ? (
                <>
                  <Mail className="w-5 h-5" />
                  {ts("inviteEmail.send")}
                </>
              ) : (
                <>
                  <Users className="w-5 h-5" />
                  {ts("invite.generateLink")}
                </>
              )}
            </button>
          ) : (
            <div className="p-4 bg-green-50 rounded-xl border border-green-200">
              <p className="text-sm font-medium text-green-800 mb-1">{ts("invite.inviteCreated")}</p>
              {emailOutcome === "sent" && <p className="text-xs text-green-700 mb-3">{ts("inviteEmail.outcomeSent")}</p>}
              {emailOutcome === "skipped_no_key" && (
                <p className="text-xs text-amber-700 mb-3">{ts("inviteEmail.outcomeNoKey")}</p>
              )}
              {emailOutcome === "skipped_suppressed" && (
                <p className="text-xs text-orange-700 mb-3">{ts("inviteEmail.outcomeSuppressed")}</p>
              )}
              {emailOutcome === "failed" && <p className="text-xs text-red-700 mb-3">{ts("inviteEmail.outcomeFailed")}</p>}
              {!emailOutcome && <div className="mb-3" />}
              <div className="flex items-center gap-2">
                <input
                  aria-label={t("a11y.inviteLink")}
                  type="text"
                  value={inviteUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-green-200 rounded-lg text-sm bg-white text-slate-600 truncate"
                />
                <button
                  onClick={handleCopyInviteUrl}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                    inviteCopied ? "bg-green-600 text-white" : "bg-green-500 text-white hover:bg-green-600"
                  )}
                >
                  {inviteCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {inviteCopied ? tb("copied") : tb("copy")}
                </button>
              </div>
              <button
                onClick={() => setInviteUrl(null)}
                className="mt-3 text-sm text-green-700 hover:text-green-800 font-medium"
              >
                {ts("invite.generateAnother")}
              </button>
            </div>
          )}
        </>
      )}

      {/* Current Collaborators */}
      {collaborators.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-3">{ts("invite.teamMembers", { count: collaborators.length })}</h4>
          {isLoadingCollaborators ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="w-6 h-6 text-slate-500" />
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {collaborators.map((collaborator) => (
                <CollaboratorRow
                  key={collaborator.id}
                  collaborator={collaborator}
                  isCurrentUser={collaborator.user_id === currentUserId}
                  canManage={collaborators[0]?.user_id === currentUserId} // First is owner
                  onRoleChange={handleRoleChange}
                  onRemove={handleRemoveCollaborator}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
