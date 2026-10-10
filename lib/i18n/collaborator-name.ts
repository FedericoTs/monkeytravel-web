import { useTranslations } from "next-intl";
import type { TripCollaborator } from "@/types";

/**
 * A trip member's name, or a stand-in in the viewer's language for someone who
 * never set one. The collaborators API returns null for them rather than a word.
 */
export function useCollaboratorName(): (collaborator: Pick<TripCollaborator, "display_name" | "role">) => string {
  const t = useTranslations("common.collaborators");
  return (collaborator) =>
    collaborator.display_name?.trim() || t(collaborator.role === "owner" ? "ownerFallback" : "memberFallback");
}
