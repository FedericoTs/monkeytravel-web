"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useCollaboratorName } from "@/lib/i18n/collaborator-name";
import { TripCollaborator } from "@/types";

interface CollaboratorAvatarsProps {
  collaborators: TripCollaborator[];
  maxVisible?: number;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  showAddButton?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-10 h-10 text-base",
};

const overlapClasses = {
  sm: "-ml-2",
  md: "-ml-2.5",
  lg: "-ml-3",
};

export function CollaboratorAvatars({
  collaborators,
  maxVisible = 4,
  size = "md",
  onClick,
  showAddButton = true,
  className,
}: CollaboratorAvatarsProps) {
  const t = useTranslations("common.collaborators");
  const nameOf = useCollaboratorName();
  const visibleCollaborators = collaborators.slice(0, maxVisible);
  const hiddenCount = Math.max(0, collaborators.length - maxVisible);
  const sizeClass = sizeClasses[size];
  const overlapClass = overlapClasses[size];

  if (collaborators.length === 0 && !showAddButton) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center group",
        onClick && "cursor-pointer",
        className
      )}
      aria-label={t("avatarsAriaLabel", { count: collaborators.length })}
    >
      {/* Avatar stack */}
      <div className="flex items-center">
        {visibleCollaborators.map((collaborator, index) => (
          <div
            key={collaborator.id}
            className={cn(
              sizeClass,
              "rounded-full ring-2 ring-white flex-shrink-0 overflow-hidden",
              index > 0 && overlapClass
            )}
            style={{ zIndex: maxVisible - index }}
            title={nameOf(collaborator)}
          >
            {collaborator.avatar_url ? (
              <img
                src={collaborator.avatar_url}
                alt={nameOf(collaborator)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[var(--primary)] to-blue-400 flex items-center justify-center text-white font-medium">
                {collaborator.display_name?.charAt(0)?.toUpperCase() || "?"}
              </div>
            )}
          </div>
        ))}

        {/* Hidden count indicator */}
        {hiddenCount > 0 && (
          <div
            className={cn(
              sizeClass,
              overlapClass,
              "rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-gray-600 font-medium"
            )}
            style={{ zIndex: 0 }}
          >
            +{hiddenCount}
          </div>
        )}
      </div>

      {/* Add/invite button */}
      {showAddButton && (
        <div
          className={cn(
            sizeClass,
            collaborators.length > 0 ? overlapClass : "",
            "rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-gray-400 group-hover:text-[var(--primary-ink)] group-hover:bg-blue-50 transition-colors"
          )}
          style={{ zIndex: 0 }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>
      )}
    </button>
  );
}

export default CollaboratorAvatars;
