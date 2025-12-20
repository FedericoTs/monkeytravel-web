"use client";

import { cn } from "@/lib/utils";
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
      aria-label={`${collaborators.length} collaborators. Click to manage team.`}
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
            title={collaborator.display_name}
          >
            {collaborator.avatar_url ? (
              <img
                src={collaborator.avatar_url}
                alt={collaborator.display_name}
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
            "rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-gray-400 group-hover:text-[var(--primary)] group-hover:bg-blue-50 transition-colors"
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

// Compact inline version for headers
export function CollaboratorAvatarsInline({
  collaborators,
  onClick,
  className,
}: {
  collaborators: TripCollaborator[];
  onClick?: () => void;
  className?: string;
}) {
  if (collaborators.length === 0) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-[var(--primary)] transition-colors text-sm font-medium",
          className
        )}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        <span>Invite</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 transition-colors",
        className
      )}
    >
      <CollaboratorAvatars
        collaborators={collaborators}
        maxVisible={3}
        size="sm"
        showAddButton={true}
        onClick={undefined} // Parent button handles click
      />
      <span className="text-sm font-medium text-gray-700 pr-1">
        {collaborators.length} {collaborators.length === 1 ? "person" : "people"}
      </span>
    </button>
  );
}

export default CollaboratorAvatars;
