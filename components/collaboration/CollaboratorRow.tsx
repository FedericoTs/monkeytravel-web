"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { TripCollaborator, CollaboratorRole, ROLE_INFO } from "@/types";

interface CollaboratorRowProps {
  collaborator: TripCollaborator;
  isCurrentUser: boolean;
  canManage: boolean;
  onRoleChange?: (userId: string, newRole: CollaboratorRole) => Promise<void>;
  onRemove?: (userId: string) => Promise<void>;
}

export function CollaboratorRow({
  collaborator,
  isCurrentUser,
  canManage,
  onRoleChange,
  onRemove,
}: CollaboratorRowProps) {
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);

  const roleInfo = ROLE_INFO[collaborator.role];
  const isOwner = collaborator.role === "owner";

  const handleRoleChange = async (newRole: CollaboratorRole) => {
    if (!onRoleChange || newRole === collaborator.role) {
      setShowRoleDropdown(false);
      return;
    }

    setIsChangingRole(true);
    try {
      await onRoleChange(collaborator.user_id, newRole);
    } finally {
      setIsChangingRole(false);
      setShowRoleDropdown(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemove) return;

    const confirmMessage = isCurrentUser
      ? "Are you sure you want to leave this trip?"
      : `Remove ${collaborator.display_name} from this trip?`;

    if (!confirm(confirmMessage)) return;

    setIsRemoving(true);
    try {
      await onRemove(collaborator.user_id);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-lg transition-colors",
      isCurrentUser ? "bg-blue-50/50" : "hover:bg-gray-50"
    )}>
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {collaborator.avatar_url ? (
          <img
            src={collaborator.avatar_url}
            alt={collaborator.display_name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--primary)] to-blue-400 flex items-center justify-center text-white font-medium">
            {collaborator.display_name?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
        {/* Owner crown badge */}
        {isOwner && (
          <span className="absolute -top-1 -right-1 text-sm">👑</span>
        )}
      </div>

      {/* Name and role */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 truncate">
            {collaborator.display_name}
          </span>
          {isCurrentUser && (
            <span className="text-xs text-gray-500">(you)</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span>{roleInfo.emoji}</span>
          <span>{roleInfo.label}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Role dropdown (only for non-owners when user can manage) */}
        {canManage && !isOwner && !isCurrentUser && (
          <div className="relative">
            <button
              onClick={() => setShowRoleDropdown(!showRoleDropdown)}
              disabled={isChangingRole}
              className={cn(
                "px-2.5 py-1.5 text-sm font-medium rounded-lg border transition-colors",
                showRoleDropdown
                  ? "border-[var(--primary)] bg-blue-50 text-[var(--primary)]"
                  : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              )}
            >
              {isChangingRole ? (
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  Change
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              )}
            </button>

            {/* Dropdown */}
            {showRoleDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowRoleDropdown(false)}
                />
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {(["editor", "voter", "viewer"] as const).map((role) => {
                    const info = ROLE_INFO[role];
                    const isSelected = role === collaborator.role;

                    return (
                      <button
                        key={role}
                        onClick={() => handleRoleChange(role)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                          isSelected
                            ? "bg-blue-50 text-[var(--primary)]"
                            : "text-gray-700 hover:bg-gray-50"
                        )}
                      >
                        <span>{info.emoji}</span>
                        <span>{info.label}</span>
                        {isSelected && (
                          <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Remove button */}
        {((canManage && !isOwner) || isCurrentUser) && !isOwner && (
          <button
            onClick={handleRemove}
            disabled={isRemoving}
            className={cn(
              "p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors",
              isRemoving && "opacity-50 cursor-not-allowed"
            )}
            title={isCurrentUser ? "Leave trip" : "Remove from trip"}
          >
            {isRemoving ? (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default CollaboratorRow;
