"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, Globe, Users, Copy, Check, Mail, Share2, Eye, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  trackShareModalOpened,
  trackTripShared,
  trackReferralLinkClicked,
} from "@/lib/analytics";
import { RoleSelector } from "@/components/collaboration/RoleSelector";
import { CollaboratorRow } from "@/components/collaboration/CollaboratorRow";
import { useToast } from "@/components/ui/Toast";
import BottomSheet from "@/components/ui/BottomSheet";
import { useModalBehavior } from "@/lib/hooks/useModalBehavior";
import type { TripCollaborator, TripInvite, CollaboratorRole } from "@/types";

type TabType = "share" | "invite";

interface ShareAndInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  // Share props
  shareUrl: string;
  isShared: boolean;
  isInTrending?: boolean;
  onStopSharing: () => void;
  onEnableSharing: () => Promise<void>;
  onTrendingChange?: (isTrending: boolean) => void;
  isLoading: boolean;
  // Initial tab (for opening directly to invite tab)
  initialTab?: TabType;
}

export default function ShareAndInviteModal({
  isOpen,
  onClose,
  tripId,
  tripTitle,
  shareUrl,
  isShared,
  isInTrending = false,
  onStopSharing,
  onEnableSharing,
  onTrendingChange,
  isLoading,
  initialTab = "share",
}: ShareAndInviteModalProps) {
  const t = useTranslations("share");
  const tButtons = useTranslations("buttons");
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [copied, setCopied] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [trendingEnabled, setTrendingEnabled] = useState(isInTrending);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Toast notifications
  const { addToast } = useToast();

  // Invite state
  const [selectedRole, setSelectedRole] = useState<Exclude<CollaboratorRole, "owner">>("voter");
  const [collaborators, setCollaborators] = useState<TripCollaborator[]>([]);
  const [pendingInvites, setPendingInvites] = useState<(TripInvite & { inviteUrl: string })[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Fetch current user
  useEffect(() => {
    if (isOpen) {
      fetch("/api/auth/session")
        .then((res) => res.json())
        .then((data) => {
          if (data.user?.id) {
            setCurrentUserId(data.user.id);
          }
        })
        .catch(console.error);
    }
  }, [isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setCopied(false);
      setShowStopConfirm(false);
      setTrendingEnabled(isInTrending);
      setInviteUrl(null);
      setInviteCopied(false);

      // Track modal opened
      trackShareModalOpened({
        tripId,
        tripDestination: tripTitle,
      });

      // Fetch collaborators
      fetchCollaborators();
    }
  }, [isOpen, initialTab, isInTrending, tripId, tripTitle]);

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

  // Unified modal behavior: escape key + scroll lock
  useModalBehavior({ isOpen, onClose });

  // Handle trending toggle
  const handleTrendingToggle = async () => {
    if (trendingLoading) return;

    setTrendingLoading(true);
    try {
      const method = trendingEnabled ? "DELETE" : "POST";
      const response = await fetch(`/api/trips/${tripId}/submit-trending`, { method });

      if (response.ok) {
        setTrendingEnabled(!trendingEnabled);
        onTrendingChange?.(!trendingEnabled);
      }
    } catch (error) {
      console.error("Failed to update trending status:", error);
    } finally {
      setTrendingLoading(false);
    }
  };

  // Copy share URL
  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast(t("toast.viewOnlyCopied"), "success");
      trackTripShared({ tripId, shareMethod: "link" });
      trackReferralLinkClicked({ code: tripId, medium: "copy" });
    } catch (error) {
      console.error("Failed to copy:", error);
      addToast(t("toast.copyFailed"), "error");
    }
  };

  // Social sharing
  const handleShareTwitter = () => {
    const text = encodeURIComponent(t("socialText.twitterShare", { tripTitle }));
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
    trackTripShared({ tripId, shareMethod: "social" });
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(`${t("socialText.whatsappShare", { tripTitle })}\n${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    trackTripShared({ tripId, shareMethod: "social" });
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(t("socialText.emailSubject", { tripTitle }));
    const body = encodeURIComponent(`${t("socialText.emailBody")}\n\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    trackTripShared({ tripId, shareMethod: "email" });
  };

  // Generate invite link
  const handleGenerateInvite = async () => {
    setIsGeneratingInvite(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });

      if (response.ok) {
        const data = await response.json();
        setInviteUrl(data.invite.inviteUrl);
        addToast(t("toast.inviteCreated"), "success");
      } else {
        const error = await response.json();
        console.error("Failed to generate invite:", error);
        addToast(error.error || t("toast.inviteCreateFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to generate invite:", error);
      addToast(t("toast.networkError"), "error");
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
      addToast(t("toast.collaborationCopied"), "success");
    } catch (error) {
      console.error("Failed to copy:", error);
      addToast(t("toast.copyFailed"), "error");
    }
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
        await fetchCollaborators();
        addToast(t("toast.roleUpdated", { role: newRole }), "success");
      } else {
        addToast(t("toast.roleUpdateFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to update role:", error);
      addToast(t("toast.roleUpdateFailed"), "error");
    }
  };

  // Remove collaborator
  const handleRemoveCollaborator = async (userId: string) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/collaborators/${userId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchCollaborators();
        addToast(t("toast.memberRemoved"), "success");
      } else {
        addToast(t("toast.memberRemoveFailed"), "error");
      }
    } catch (error) {
      console.error("Failed to remove collaborator:", error);
      addToast(t("toast.memberRemoveFailed"), "error");
    }
  };

  if (!isOpen) return null;

  const hasCollaborators = collaborators.length > 1; // More than just owner

  // Tab buttons component (reused in both mobile and desktop)
  const TabButtons = ({ className = "" }: { className?: string }) => (
    <div className={cn("flex gap-2", className)}>
      <button
        onClick={() => setActiveTab("share")}
        className={cn(
          "flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 transition-all",
          activeTab === "share"
            ? "border-slate-300 bg-slate-50 shadow-sm"
            : "border-transparent bg-slate-100/50 hover:bg-slate-100"
        )}
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center",
          activeTab === "share" ? "bg-slate-200" : "bg-slate-200/50"
        )}>
          <Eye className={cn("w-4 h-4", activeTab === "share" ? "text-slate-700" : "text-slate-500")} />
        </div>
        <span className={cn("text-sm font-medium", activeTab === "share" ? "text-slate-900" : "text-slate-600")}>
          {t("invite.viewOnlyLink")}
        </span>
        <span className="text-xs text-slate-400">{t("invite.anyoneCanView")}</span>
      </button>
      <button
        onClick={() => setActiveTab("invite")}
        className={cn(
          "flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 transition-all",
          activeTab === "invite"
            ? "border-[var(--primary)] bg-blue-50 shadow-sm"
            : "border-transparent bg-blue-50/30 hover:bg-blue-50/60"
        )}
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center relative",
          activeTab === "invite" ? "bg-[var(--primary)]" : "bg-blue-100"
        )}>
          <UserPlus className={cn("w-4 h-4", activeTab === "invite" ? "text-white" : "text-[var(--primary)]")} />
          {hasCollaborators && (
            <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full flex items-center justify-center">
              {collaborators.length - 1}
            </span>
          )}
        </div>
        <span className={cn("text-sm font-medium", activeTab === "invite" ? "text-[var(--primary)]" : "text-slate-600")}>
          {t("invite.inviteToCollaborate")}
        </span>
        <span className="text-xs text-slate-400">{t("invite.editVoteSuggest")}</span>
      </button>
    </div>
  );

  // Content component (reused in both mobile and desktop)
  const ModalContent = () => (
    <>
      {activeTab === "share" ? (
        // SHARE TAB - View Only
        <div className="space-y-6">
                {/* Context hint */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-lg">
                  <Eye className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <p className="text-xs text-slate-600">
                    <span className="font-medium">{t("invite.viewOnlyLabel")}:</span> {t("invite.viewOnlyHint")}
                  </p>
                </div>

                {/* Enable sharing if not shared */}
                {!isShared && (
                  <div className="text-center py-4">
                    <p className="text-sm text-slate-600 mb-4">
                      {t("invite.enableSharing")}
                    </p>
                    <button
                      onClick={onEnableSharing}
                      disabled={isLoading}
                      className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
                    >
                      {isLoading ? t("invite.enabling") : t("invite.enableSharingButton")}
                    </button>
                  </div>
                )}

                {/* Share URL */}
                {isShared && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("invite.publicLink")}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={shareUrl}
                          readOnly
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-600 truncate"
                        />
                        <button
                          onClick={handleCopyShareUrl}
                          className={cn(
                            "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            copied
                              ? "bg-green-100 text-green-700"
                              : "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
                          )}
                        >
                          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copied ? tButtons("copied") : tButtons("copy")}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {t("invite.readOnlyNote")}
                      </p>
                    </div>

                    {/* Social Share */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {t("shareVia")}
                      </label>
                      <div className="flex items-center gap-3">
                        <button onClick={handleShareTwitter} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                          </svg>
                        </button>
                        <button onClick={handleShareWhatsApp} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                          </svg>
                        </button>
                        <button onClick={handleShareEmail} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
                          <Mail className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Submit to Trending */}
                    <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                            {trendingEnabled ? <Globe className="w-5 h-5 text-white" /> : <TrendingUp className="w-5 h-5 text-white" />}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {trendingEnabled ? t("explore.listedOn") : t("explore.submitTo")}
                            </p>
                            <p className="text-xs text-slate-500">
                              {trendingEnabled ? t("explore.visibleInGallery") : t("explore.letOthersDiscover")}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={handleTrendingToggle}
                          disabled={trendingLoading}
                          className={cn(
                            "relative w-12 h-7 rounded-full transition-colors",
                            trendingEnabled ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-slate-200",
                            trendingLoading && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <span className={cn("absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform", trendingEnabled ? "translate-x-6" : "translate-x-1")} />
                        </button>
                      </div>
                    </div>

                    {/* Stop Sharing */}
                    <div className="border-t border-slate-200 pt-4">
                      {!showStopConfirm ? (
                        <button onClick={() => setShowStopConfirm(true)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                          {t("stopSharing.button")}
                        </button>
                      ) : (
                        <div className="bg-red-50 rounded-lg p-4">
                          <p className="text-sm text-red-800 mb-3">
                            {t("stopSharing.confirmMessage")}
                          </p>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setShowStopConfirm(false)} className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 rounded-lg transition-colors border border-slate-200">
                              {tButtons("cancel")}
                            </button>
                            <button onClick={onStopSharing} disabled={isLoading} className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50">
                              {isLoading ? t("stopSharing.stopping") : t("stopSharing.stop")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              // INVITE TAB - Collaboration
              <div className="space-y-6">
                {/* Context hint */}
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                  <UserPlus className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
                  <p className="text-xs text-blue-700">
                    <span className="font-medium">{t("invite.collaborateLabel")}:</span> {t("invite.collaborateHint")}
                  </p>
                </div>

                {/* Role Selection */}
                <RoleSelector
                  selectedRole={selectedRole}
                  onRoleChange={setSelectedRole}
                  disabled={isGeneratingInvite}
                />

                {/* Generate Invite */}
                {!inviteUrl ? (
                  <button
                    onClick={handleGenerateInvite}
                    disabled={isGeneratingInvite}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
                  >
                    {isGeneratingInvite ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {t("invite.generating")}
                      </>
                    ) : (
                      <>
                        <Users className="w-5 h-5" />
                        {t("invite.generateLink")}
                      </>
                    )}
                  </button>
                ) : (
                  <div className="p-4 bg-green-50 rounded-xl border border-green-200">
                    <p className="text-sm font-medium text-green-800 mb-3">
                      {t("invite.inviteCreated")}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={inviteUrl}
                        readOnly
                        className="flex-1 px-3 py-2 border border-green-200 rounded-lg text-sm bg-white text-slate-600 truncate"
                      />
                      <button
                        onClick={handleCopyInviteUrl}
                        className={cn(
                          "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                          inviteCopied
                            ? "bg-green-600 text-white"
                            : "bg-green-500 text-white hover:bg-green-600"
                        )}
                      >
                        {inviteCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {inviteCopied ? tButtons("copied") : tButtons("copy")}
                      </button>
                    </div>
                    <button
                      onClick={() => setInviteUrl(null)}
                      className="mt-3 text-sm text-green-700 hover:text-green-800 font-medium"
                    >
                      {t("invite.generateAnother")}
                    </button>
                  </div>
                )}

                {/* Current Collaborators */}
                {collaborators.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-700 mb-3">
                      {t("invite.teamMembers", { count: collaborators.length })}
                    </h4>
                    {isLoadingCollaborators ? (
                      <div className="flex items-center justify-center py-8">
                        <svg className="w-6 h-6 animate-spin text-slate-400" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
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
      )}
    </>
  );

  // Mobile: Use BottomSheet for better UX
  if (isMobile) {
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose} title={t("titleWithInvite")}>
        <div className="px-4 pb-6">
          {/* Tabs */}
          <div className="border-b border-slate-200 mb-4">
            <TabButtons />
          </div>
          {/* Content */}
          <ModalContent />
        </div>
      </BottomSheet>
    );
  }

  // Desktop: Traditional centered modal
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Header with tabs */}
          <div className="border-b border-slate-200">
            <div className="flex items-center gap-4 px-6 pt-6 pb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
                <Share2 className="w-6 h-6 text-[var(--primary)]" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900">{t("titleWithInvite")}</h3>
                <p className="text-sm text-slate-500 truncate">{tripTitle}</p>
              </div>
            </div>

            {/* Tabs */}
            <TabButtons className="px-6" />
          </div>

          {/* Content */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            <ModalContent />
          </div>
        </div>
      </div>
    </div>
  );
}
