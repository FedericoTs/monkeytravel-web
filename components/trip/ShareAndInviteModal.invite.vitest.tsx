/** @vitest-environment jsdom */
/**
 * The share window's invite tab, through the window: who is on the trip, a link or
 * an emailed invite, what each answer says, and what a change of role or a removal
 * does to the link on screen. The other tab, the sheet and the co-planner list
 * have tests of their own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en/common.json";
import type { CollaboratorRole, TripCollaborator } from "@/types";
import ShareAndInviteModal from "./ShareAndInviteModal";

vi.mock("@/lib/native/share", () => ({ shareFile: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({ captureTripCardShared: vi.fn() }));
const analytics = vi.hoisted(() => ({
  trackShareModalOpened: vi.fn(),
  trackTripShared: vi.fn(),
  trackReferralLinkClicked: vi.fn(),
}));
vi.mock("@/lib/analytics", () => analytics);
const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
const auth = vi.hoisted(() => ({ user: { id: "owner-1" } as { id: string } | null }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/lib/native/external-link", () => ({ openExternal: vi.fn() }));
vi.mock("@/components/ui/BottomSheet", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/trip/CoPlannerInvites", () => ({
  default: (p: { tripId: string; tripTitle: string; surface: string }) => (
    <div>
      co-planners of {p.tripId} / {p.tripTitle} / {p.surface}
    </div>
  ),
}));
vi.mock("@/components/collaboration/RoleSelector", () => ({
  RoleSelector: (p: { selectedRole: string; onRoleChange: (r: "voter") => void; disabled?: boolean }) => (
    <button disabled={p.disabled} onClick={() => p.onRoleChange("voter")}>
      role is {p.selectedRole}
    </button>
  ),
}));
vi.mock("@/components/collaboration/CollaboratorRow", () => ({
  CollaboratorRow: (p: {
    collaborator: TripCollaborator;
    isCurrentUser: boolean;
    canManage: boolean;
    onRoleChange?: (userId: string, role: CollaboratorRole) => Promise<void>;
    onRemove?: (userId: string) => Promise<void>;
  }) => (
    <div>
      <span>
        {p.collaborator.display_name} current={String(p.isCurrentUser)} manage={String(p.canManage)}
      </span>
      <button onClick={() => p.onRoleChange?.(p.collaborator.user_id, "voter")}>make {p.collaborator.display_name} a voter</button>
      <button onClick={() => p.onRemove?.(p.collaborator.user_id)}>remove {p.collaborator.display_name}</button>
    </div>
  ),
}));

const person = (name: string, userId: string): TripCollaborator => ({
  id: `c-${userId}`,
  trip_id: "trip-1",
  user_id: userId,
  role: "editor",
  invited_by: "owner-1",
  joined_at: "2026-10-01T00:00:00Z",
  display_name: name,
  avatar_url: null,
});
const owner = person("Olga", "owner-1");
const bea = person("Bea", "member-1");
const INVITE_URL = "https://monkeytravel.app/invite/abc";

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
type Answer = Awaited<ReturnType<typeof json>> | Promise<Awaited<ReturnType<typeof json>>>;
const answers = {
  list: (): Answer => json(200, { collaborators: [owner, bea] }),
  invite: (): Answer => json(200, { invite: { inviteUrl: INVITE_URL } }),
  patch: (): Answer => json(200, {}),
  remove: (): Answer => json(200, {}),
};
const calls = (test: (url: string, method: string) => boolean) =>
  vi.mocked(fetch).mock.calls.filter(([url, init]) => test(String(url), init?.method ?? "GET"));
const listCalls = () => calls((url, method) => url === "/api/trips/trip-1/collaborators" && method === "GET");
const invitePost = () => {
  const [post] = calls((url, method) => url === "/api/trips/trip-1/invites" && method === "POST");
  return JSON.parse(String(post?.[1]?.body));
};

const defaults = {
  isOpen: true,
  onClose: vi.fn(),
  tripId: "trip-1",
  tripTitle: "Lisbon Trip",
  shareUrl: "https://monkeytravel.app/shared/11111111-2222-3333-4444-555555555555",
  isShared: true,
  onStopSharing: vi.fn(),
  onEnableSharing: vi.fn(async () => undefined),
  isLoading: false,
  initialTab: "invite" as const,
};
const windowWith = (props: Partial<typeof defaults> = {}) => (
  <NextIntlClientProvider locale="en" messages={{ common: en }}>
    <ShareAndInviteModal {...defaults} {...props} />
  </NextIntlClientProvider>
);
const show = (props: Partial<typeof defaults> = {}) => render(windowWith(props));
const moreOptions = () => screen.getByRole("button", { name: en.share.coplanners.moreOptions });
const emailField = () => screen.getByPlaceholderText("friend@example.com");
const noteField = () => screen.getByPlaceholderText(en.share.inviteEmail.notePlaceholder);
/** Opens "More invite options". */
async function showOptions(props: Partial<typeof defaults> = {}) {
  const view = show(props);
  fireEvent.click(moreOptions());
  await settled();
  return view;
}
const settled = () => act(async () => {});
const generate = () => fireEvent.click(screen.getByRole("button", { name: en.share.invite.generateLink }));
const send = () => fireEvent.click(screen.getByRole("button", { name: en.share.inviteEmail.send }));
const linkBox = () => screen.getByLabelText(en.a11y.inviteLink) as HTMLInputElement;
const copyButton = () => screen.getByRole("button", { name: en.buttons.copy });

beforeEach(() => {
  auth.user = { id: "owner-1" };
  answers.list = () => json(200, { collaborators: [owner, bea] });
  answers.invite = () => json(200, { invite: { inviteUrl: INVITE_URL } });
  answers.patch = () => json(200, {});
  answers.remove = () => json(200, {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/invites") && init?.method === "POST") return answers.invite();
      if (url.endsWith("/invites")) return json(200, { invites: [] });
      if (url.includes("/collaborators/") && init?.method === "PATCH") return answers.patch();
      if (url.includes("/collaborators/") && init?.method === "DELETE") return answers.remove();
      if (url.endsWith("/collaborators")) return answers.list();
      return json(200, {});
    })
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("who is on the trip", () => {
  it("loads when the window opens, and lists them", async () => {
    show();
    expect(await screen.findByText(/^Bea /)).toBeTruthy();
    expect(screen.getByText(/^Olga /)).toBeTruthy();
    expect(listCalls()).toHaveLength(1);
  });

  it("counts the team, and badges the tab with everyone but the owner", async () => {
    show();
    await screen.findByText(/^Bea /);
    expect(screen.getByRole("heading", { level: 4 }).textContent).toContain("2");
    const tab = screen.getByRole("button", { name: new RegExp(en.share.invite.inviteToCollaborate) });
    expect(tab.textContent).toContain("1");
  });

  it("shows no badge while the owner is alone, on either tab", async () => {
    answers.list = () => json(200, { collaborators: [owner] });
    show({ initialTab: "share" as never });
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    await settled();
    const tab = screen.getByRole("button", { name: new RegExp(en.share.invite.inviteToCollaborate) });
    expect(tab.querySelector(".bg-amber-400")).toBeNull();
  });

  it("shows no team while there is nobody, and stays open when the list is refused or fails", async () => {
    answers.list = () => json(500, {});
    show();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    await settled();
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
    cleanup();
    answers.list = () => Promise.reject(new TypeError("Load failed"));
    vi.mocked(fetch).mockClear();
    show();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    await settled();
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
    expect(console.error).toHaveBeenCalled();
    expect(moreOptions()).toBeTruthy();
  });

  it("keeps the team on screen when a reload is refused", async () => {
    show();
    await screen.findByText(/^Bea /);
    answers.list = () => json(500, {});
    fireEvent.click(screen.getByRole("button", { name: "make Bea a voter" }));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(await screen.findByText(/^Bea /)).toBeTruthy();
  });

  it("lets only the owner, listed first, manage, and marks the viewer's own row", async () => {
    show();
    expect(await screen.findByText("Olga current=true manage=true")).toBeTruthy();
    expect(screen.getByText("Bea current=false manage=true")).toBeTruthy();
    cleanup();
    auth.user = { id: "member-1" };
    show();
    expect(await screen.findByText("Olga current=false manage=false")).toBeTruthy();
    expect(screen.getByText("Bea current=true manage=false")).toBeTruthy();
  });

  it("swaps the list for a spinner while it reloads", async () => {
    let release = (_: Awaited<Answer>) => {};
    show();
    await screen.findByText(/^Bea /);
    answers.list = () => new Promise((resolve) => (release = resolve));
    fireEvent.click(screen.getByRole("button", { name: "make Bea a voter" }));
    await waitFor(() => expect(screen.queryByText(/^Bea /)).toBeNull());
    await act(async () => release(json(200, { collaborators: [owner, bea] })));
    expect(await screen.findByText(/^Bea /)).toBeTruthy();
  });
});

describe("the tab", () => {
  it("leads with the named co-planners, and keeps the rest behind More invite options", async () => {
    show();
    await settled();
    expect(screen.getByText("co-planners of trip-1 / Lisbon Trip / invite_tab")).toBeTruthy();
    expect(moreOptions().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByPlaceholderText("friend@example.com")).toBeNull();
    expect(screen.queryByText(/role is/)).toBeNull();
    fireEvent.click(moreOptions());
    expect(moreOptions().getAttribute("aria-expanded")).toBe("true");
    expect(emailField()).toBeTruthy();
    expect(screen.getByText("role is editor")).toBeTruthy();
    fireEvent.click(moreOptions());
    expect(screen.queryByPlaceholderText("friend@example.com")).toBeNull();
  });
});

describe("a link invite", () => {
  it("asks for an editor by default, and for no one in particular", async () => {
    await showOptions();
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(invitePost()).toEqual({ role: "editor" });
  });

  it("asks for the role chosen", async () => {
    await showOptions();
    fireEvent.click(screen.getByText("role is editor"));
    expect(screen.getByText("role is voter")).toBeTruthy();
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(invitePost()).toEqual({ role: "voter" });
  });

  it("offers the link, says it's made, and mentions no email", async () => {
    await showOptions();
    generate();
    expect((await screen.findByLabelText<HTMLInputElement>(en.a11y.inviteLink)).value).toBe(INVITE_URL);
    expect(screen.getByText(en.share.invite.inviteCreated)).toBeTruthy();
    expect(addToast).toHaveBeenCalledExactlyOnceWith(en.share.toast.inviteCreated, "success");
    expect(screen.queryByText(en.share.inviteEmail.outcomeSent)).toBeNull();
  });

  it("shows it's working and locks the fields while it asks", async () => {
    let release = (_: Awaited<Answer>) => {};
    answers.invite = () => new Promise((resolve) => (release = resolve));
    await showOptions();
    generate();
    const working = await screen.findByRole("button", { name: en.share.invite.generating });
    expect((working as HTMLButtonElement).disabled).toBe(true);
    expect((emailField() as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByText("role is editor") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release(json(200, { invite: { inviteUrl: INVITE_URL } })));
    expect(await screen.findByLabelText(en.a11y.inviteLink)).toBeTruthy();
  });

  it("can make another", async () => {
    await showOptions();
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    fireEvent.click(screen.getByRole("button", { name: en.share.invite.generateAnother }));
    expect(screen.queryByLabelText(en.a11y.inviteLink)).toBeNull();
    expect(screen.getByRole("button", { name: en.share.invite.generateLink })).toBeTruthy();
  });

  it("says when it can't be made, and lets them try again", async () => {
    answers.invite = () => json(500, { error: "boom" });
    await showOptions();
    generate();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.inviteCreateFailed, "error"));
    expect(screen.queryByLabelText(en.a11y.inviteLink)).toBeNull();
    expect((screen.getByRole("button", { name: en.share.invite.generateLink }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a refusal with no address isn't blamed on an address", async () => {
    answers.invite = () => json(400, { error: "bad" });
    await showOptions();
    generate();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.inviteCreateFailed, "error"));
  });

  it("says when the connection dropped", async () => {
    answers.invite = () => Promise.reject(new TypeError("Load failed"));
    await showOptions();
    generate();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.networkError, "error"));
    expect((screen.getByRole("button", { name: en.share.invite.generateLink }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("an emailed invite", () => {
  const typeEmail = (value: string) => fireEvent.change(emailField(), { target: { value } });

  it("the button says send, and a note appears only once there's an address", async () => {
    await showOptions();
    expect(screen.queryByPlaceholderText(en.share.inviteEmail.notePlaceholder)).toBeNull();
    typeEmail("   ");
    expect(screen.queryByPlaceholderText(en.share.inviteEmail.notePlaceholder)).toBeNull();
    expect(screen.getByRole("button", { name: en.share.invite.generateLink })).toBeTruthy();
    typeEmail("bea@example.com");
    expect(noteField()).toBeTruthy();
    expect(screen.getByRole("button", { name: en.share.inviteEmail.send })).toBeTruthy();
  });

  it("sends the trimmed address and note, and counts the note's characters", async () => {
    await showOptions();
    typeEmail("  bea@example.com ");
    fireEvent.change(noteField(), { target: { value: "  come along  " } });
    expect(screen.getByText("14/500")).toBeTruthy();
    send();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(invitePost()).toEqual({ role: "editor", recipientEmail: "bea@example.com", message: "come along" });
  });

  it("sends no note when it's blank", async () => {
    await showOptions();
    typeEmail("bea@example.com");
    fireEvent.change(noteField(), { target: { value: "   " } });
    send();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(invitePost()).toEqual({ role: "editor", recipientEmail: "bea@example.com" });
  });

  it("empties the fields once it's made, so someone else can be invited", async () => {
    await showOptions();
    typeEmail("bea@example.com");
    fireEvent.change(noteField(), { target: { value: "hello" } });
    send();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect((emailField() as HTMLInputElement).value).toBe("");
    expect(screen.queryByPlaceholderText(en.share.inviteEmail.notePlaceholder)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.share.invite.generateAnother }));
    typeEmail("cy@example.com");
    expect((noteField() as HTMLTextAreaElement).value).toBe("");
  });

  it.each([
    ["sent", en.share.inviteEmail.outcomeSent, "success"],
    ["skipped_no_key", en.share.inviteEmail.outcomeNoKey, "info"],
    ["skipped_suppressed", en.share.inviteEmail.outcomeSuppressed, "warning"],
    ["failed", en.share.inviteEmail.outcomeFailed, "warning"],
  ] as const)("says what happened when the answer is %s, in the tab and in a toast", async (emailOutcome, words, kind) => {
    answers.invite = () => json(200, { invite: { inviteUrl: INVITE_URL }, emailOutcome });
    await showOptions();
    typeEmail("bea@example.com");
    send();
    expect(await screen.findByText(words)).toBeTruthy();
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast.mock.calls[0][1]).toBe(kind);
    expect(addToast.mock.calls[0][0]).not.toBe(en.share.toast.inviteCreated);
  });

  it("names the address in the toast when it went out", async () => {
    answers.invite = () => json(200, { invite: { inviteUrl: INVITE_URL }, emailOutcome: "sent" });
    await showOptions();
    typeEmail(" bea@example.com ");
    send();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(addToast.mock.calls[0][0]).toContain("bea@example.com");
  });

  it("an outcome it doesn't know is only a made invite", async () => {
    answers.invite = () => json(200, { invite: { inviteUrl: INVITE_URL }, emailOutcome: "queued" });
    await showOptions();
    typeEmail("bea@example.com");
    send();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(addToast).toHaveBeenCalledExactlyOnceWith(en.share.toast.inviteCreated, "success");
  });

  it("forgets the last outcome when the next invite is only a link", async () => {
    answers.invite = () => json(200, { invite: { inviteUrl: INVITE_URL }, emailOutcome: "sent" });
    await showOptions();
    typeEmail("bea@example.com");
    send();
    await screen.findByText(en.share.inviteEmail.outcomeSent);
    fireEvent.click(screen.getByRole("button", { name: en.share.invite.generateAnother }));
    answers.invite = () => json(200, { invite: { inviteUrl: INVITE_URL } });
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    expect(screen.queryByText(en.share.inviteEmail.outcomeSent)).toBeNull();
  });

  it("a refused address is blamed on the address, and stays to be corrected", async () => {
    answers.invite = () => json(400, { error: "Invalid recipient_email format" });
    await showOptions();
    typeEmail("bea@");
    send();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.inviteEmailInvalid, "error"));
    expect((emailField() as HTMLInputElement).value).toBe("bea@");
  });

  it("another refusal with an address typed isn't", async () => {
    answers.invite = () => json(500, { error: "boom" });
    await showOptions();
    typeEmail("bea@example.com");
    send();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.inviteCreateFailed, "error"));
  });
});

describe("copying the invite link", () => {
  const madeLink = async () => {
    await showOptions();
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    addToast.mockClear();
  };
  const secure = (value: boolean) => vi.stubGlobal("isSecureContext", value);

  it("copies it, says so, and shows Copied for a moment", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    secure(true);
    await madeLink();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(writeText).toHaveBeenCalledWith(INVITE_URL);
    expect(addToast).toHaveBeenCalledExactlyOnceWith(en.share.toast.collaborationCopied, "success");
    expect(screen.getByRole("button", { name: en.buttons.copied })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(copyButton()).toBeTruthy();
  });

  it("falls back to the old way outside a secure page, and leaves nothing behind", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    secure(false);
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    await madeLink();
    fireEvent.click(copyButton());
    await settled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
    expect(addToast).toHaveBeenCalledExactlyOnceWith(en.share.toast.collaborationCopied, "success");
  });

  it("says when it couldn't be copied", async () => {
    const writeText = vi.fn(async () => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    secure(true);
    await madeLink();
    fireEvent.click(copyButton());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.copyFailed, "error"));
    expect(copyButton()).toBeTruthy();
  });
});

describe("changing someone's role", () => {
  const change = () => fireEvent.click(screen.getByRole("button", { name: "make Bea a voter" }));

  it("asks for that person's new role, reloads the team, and says so", async () => {
    show();
    await screen.findByText(/^Bea /);
    change();
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const [patch] = calls((url, method) => url === "/api/trips/trip-1/collaborators/member-1" && method === "PATCH");
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ role: "voter" });
    expect(listCalls()).toHaveLength(2);
    expect(addToast).toHaveBeenCalledExactlyOnceWith(en.share.toast.roleUpdated.replace("{role}", en.roles.voter.label), "success");
  });

  it("takes the open link off the screen when the server switched the links off", async () => {
    answers.patch = () => json(200, { invitesReset: 2 });
    await showOptions();
    await screen.findByText(/^Bea /);
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    change();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.linksReset, "info"));
    expect(screen.queryByLabelText(en.a11y.inviteLink)).toBeNull();
  });

  it("leaves the link when none was switched off", async () => {
    answers.patch = () => json(200, { invitesReset: 0 });
    await showOptions();
    await screen.findByText(/^Bea /);
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    change();
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await settled();
    expect(linkBox().value).toBe(INVITE_URL);
    expect(addToast).not.toHaveBeenCalledWith(en.share.toast.linksReset, "info");
  });

  it("copes with an answer that has no body", async () => {
    answers.patch = () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("no body")) });
    show();
    await screen.findByText(/^Bea /);
    change();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringContaining(en.roles.voter.label), "success"));
  });

  it("says when it was refused, or the connection dropped, and reloads nothing", async () => {
    answers.patch = () => json(403, {});
    show();
    await screen.findByText(/^Bea /);
    change();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.roleUpdateFailed, "error"));
    expect(listCalls()).toHaveLength(1);
    addToast.mockClear();
    answers.patch = () => Promise.reject(new TypeError("Load failed"));
    change();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.roleUpdateFailed, "error"));
  });
});

describe("removing someone", () => {
  const removeBea = () => fireEvent.click(screen.getByRole("button", { name: "remove Bea" }));

  it("removes that person, reloads the team, and says so", async () => {
    show();
    await screen.findByText(/^Bea /);
    answers.list = () => json(200, { collaborators: [owner] });
    removeBea();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.memberRemoved, "success"));
    expect(calls((url, method) => url === "/api/trips/trip-1/collaborators/member-1" && method === "DELETE")).toHaveLength(1);
    expect(await waitFor(() => screen.queryByText(/^Bea /))).toBeNull();
  });

  it("takes the open link off the screen when the server switched the links off", async () => {
    answers.remove = () => json(200, { invitesReset: 1 });
    await showOptions();
    await screen.findByText(/^Bea /);
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    removeBea();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.linksReset, "info"));
    expect(screen.queryByLabelText(en.a11y.inviteLink)).toBeNull();
  });

  it("copes with an answer that has no body", async () => {
    answers.remove = () => ({ ok: true, status: 204, json: async () => Promise.reject(new SyntaxError("no body")) });
    show();
    await screen.findByText(/^Bea /);
    removeBea();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.memberRemoved, "success"));
  });

  it("says when it was refused, or the connection dropped, and reloads nothing", async () => {
    answers.remove = () => json(403, {});
    show();
    await screen.findByText(/^Bea /);
    removeBea();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.memberRemoveFailed, "error"));
    expect(listCalls()).toHaveLength(1);
    addToast.mockClear();
    answers.remove = () => Promise.reject(new TypeError("Load failed"));
    removeBea();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(en.share.toast.memberRemoveFailed, "error"));
  });
});

describe("moving between the tabs", () => {
  it("keeps what was typed and the link that was made", async () => {
    await showOptions();
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    fireEvent.change(emailField(), { target: { value: "cy@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.share.invite.viewOnlyLink) }));
    expect(screen.queryByPlaceholderText("friend@example.com")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.share.invite.inviteToCollaborate) }));
    expect((emailField() as HTMLInputElement).value).toBe("cy@example.com");
    expect(linkBox().value).toBe(INVITE_URL);
    expect(listCalls()).toHaveLength(1);
  });
});

describe("opening the window again", () => {
  it("reloads the team, drops the link, goes back to its first tab, and keeps a half-typed address", async () => {
    const view = await showOptions();
    generate();
    await screen.findByLabelText(en.a11y.inviteLink);
    fireEvent.change(emailField(), { target: { value: "cy@example.com" } });
    expect(analytics.trackShareModalOpened).toHaveBeenCalledTimes(1);
    expect(analytics.trackShareModalOpened).toHaveBeenCalledWith({ tripId: "trip-1", tripDestination: "Lisbon Trip" });

    view.rerender(windowWith({ isOpen: false }));
    expect(screen.queryByRole("button", { name: en.share.coplanners.moreOptions })).toBeNull();
    view.rerender(windowWith({ isOpen: true }));
    await settled();

    expect(listCalls()).toHaveLength(2);
    expect(analytics.trackShareModalOpened).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText(en.a11y.inviteLink)).toBeNull();
    expect((emailField() as HTMLInputElement).value).toBe("cy@example.com");
  });
});
