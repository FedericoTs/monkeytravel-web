import { describe, expect, it } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";
import type { TripCollaborator } from "@/types";
import { CollaboratorRow } from "@/components/collaboration/CollaboratorRow";
import { CollaboratorAvatars } from "@/components/collaboration/CollaboratorAvatars";
import { useCollaboratorName } from "./collaborator-name";

/**
 * The collaborators API used to name people without a display name "Trip Owner"
 * and "Unknown User", in English for everyone. It now returns null and the list
 * says it in the viewer's language.
 */
const COMMON = { en: enCommon, it: itCommon } as const;

function wrapperFor(locale: keyof typeof COMMON) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={{ common: COMMON[locale] }}>
      {children}
    </NextIntlClientProvider>
  );
  return Wrapper;
}

const person = (role: TripCollaborator["role"], display_name: string | null): TripCollaborator => ({
  id: `c-${role}`,
  trip_id: "trip-1",
  user_id: `user-${role}`,
  role,
  invited_by: null,
  joined_at: "2026-10-01T00:00:00Z",
  display_name,
  avatar_url: null,
});

describe("useCollaboratorName", () => {
  it("keeps a real name", () => {
    const nameOf = renderHook(() => useCollaboratorName(), { wrapper: wrapperFor("it") }).result.current;
    expect(nameOf(person("editor", "Bea"))).toBe("Bea");
  });

  it("words a nameless owner and member in Italian", () => {
    const nameOf = renderHook(() => useCollaboratorName(), { wrapper: wrapperFor("it") }).result.current;
    expect(nameOf(person("owner", null))).toBe(itCommon.collaborators.ownerFallback);
    expect(nameOf(person("voter", null))).toBe(itCommon.collaborators.memberFallback);
    expect(nameOf(person("viewer", "  "))).toBe(itCommon.collaborators.memberFallback);
  });

  it("keeps the English stand-ins for English viewers", () => {
    const nameOf = renderHook(() => useCollaboratorName(), { wrapper: wrapperFor("en") }).result.current;
    expect(nameOf(person("owner", null))).toBe("Trip Owner");
    expect(nameOf(person("editor", null))).toBe("Unknown User");
  });
});

describe("collaborator list and avatars", () => {
  it("never shows null or an empty name", () => {
    render(
      <CollaboratorRow collaborator={person("owner", null)} isCurrentUser={false} canManage={false} />,
      { wrapper: wrapperFor("it") }
    );
    expect(screen.getByText(itCommon.collaborators.ownerFallback)).toBeTruthy();
    expect(screen.queryByText("null")).toBeNull();
  });

  it("titles a nameless member's avatar in Italian", () => {
    const { container } = render(<CollaboratorAvatars collaborators={[person("editor", null)]} showAddButton={false} />, {
      wrapper: wrapperFor("it"),
    });
    expect(container.querySelector(`[title="${itCommon.collaborators.memberFallback}"]`)).not.toBeNull();
  });
});
