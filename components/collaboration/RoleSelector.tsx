"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CollaboratorRole, ROLE_INFO } from "@/types";

interface RoleSelectorProps {
  selectedRole: Exclude<CollaboratorRole, "owner">;
  onRoleChange: (role: Exclude<CollaboratorRole, "owner">) => void;
  disabled?: boolean;
  compact?: boolean;
}

const SELECTABLE_ROLES: Exclude<CollaboratorRole, "owner">[] = [
  "editor",
  "voter",
  "viewer",
];

export function RoleSelector({
  selectedRole,
  onRoleChange,
  disabled = false,
  compact = false,
}: RoleSelectorProps) {
  const t = useTranslations("common.roles");

  if (compact) {
    return (
      <div className="flex gap-2">
        {SELECTABLE_ROLES.map((role) => {
          const info = ROLE_INFO[role];
          const isSelected = selectedRole === role;

          return (
            <button
              key={role}
              onClick={() => onRoleChange(role)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                isSelected
                  ? "bg-[var(--primary)] text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <span>{info.emoji}</span>
              <span>{t(`${role}.label`)}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">
        {t("selectRole")}
      </p>
      <div className="grid gap-3">
        {SELECTABLE_ROLES.map((role) => {
          const info = ROLE_INFO[role];
          const isSelected = selectedRole === role;
          const isRecommended = role === "voter";

          return (
            <button
              key={role}
              onClick={() => onRoleChange(role)}
              disabled={disabled}
              className={cn(
                "relative flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all",
                isSelected
                  ? "border-[var(--primary)] bg-blue-50/50"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {/* Recommended badge */}
              {isRecommended && (
                <span className="absolute -top-2.5 right-3 px-2 py-0.5 text-xs font-medium bg-[var(--accent)] text-gray-900 rounded-full">
                  {t("recommended")}
                </span>
              )}

              {/* Role header */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{info.emoji}</span>
                <span className="font-semibold text-gray-900">{t(`${role}.label`)}</span>
                {isSelected && (
                  <svg
                    className="w-5 h-5 text-[var(--primary)] ml-auto"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              {/* Description */}
              <p className="text-sm text-gray-600 mb-3">
                {t(`${role}.description`)}
              </p>

              {/* Permissions */}
              <div className="space-y-1.5 w-full">
                {info.permissions.map((_, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg
                      className="w-4 h-4 text-green-500 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span>{t(`${role}.permissions.${idx}`)}</span>
                  </div>
                ))}
                {info.restrictions.slice(0, 2).map((_, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm text-gray-400">
                    <svg
                      className="w-4 h-4 text-gray-300 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    <span>{t(`${role}.restrictions.${idx}`)}</span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default RoleSelector;
