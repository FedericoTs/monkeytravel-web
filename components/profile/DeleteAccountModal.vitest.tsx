import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import esCommon from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import ptCommon from "@/messages/pt/common.json";
import DeleteAccountModal from "./DeleteAccountModal";

/**
 * The delete dialog has to work for an account with no password. Google
 * sign-ins are most accounts and have none, and the dialog used to demand one,
 * so they could never delete their account. Now everyone gets a code by email,
 * and accounts with an email sign-in can still use their password.
 */

const EMAIL = "traveler@example.com";
const BUNDLES = { en: enCommon, es: esCommon, it: itCommon, pt: ptCommon } as const;

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let deleteReply: ReturnType<typeof reply>;
let codeReply: ReturnType<typeof reply>;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<ReturnType<typeof reply>>>(async (url) =>
  url === "/api/profile/delete/code" ? codeReply : deleteReply,
);
const bodyOf = (call: number) => JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

function open(props: { canUsePassword?: boolean; locale?: keyof typeof BUNDLES } = {}) {
  const locale = props.locale ?? "en";
  const onDeleted = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={{ common: BUNDLES[locale] }}>
      <DeleteAccountModal
        isOpen
        onClose={() => {}}
        email={EMAIL}
        canUsePassword={props.canUsePassword ?? false}
        onDeleted={onDeleted}
      />
    </NextIntlClientProvider>,
  );
  return { onDeleted };
}

const t = enCommon.deleteAccount;

beforeEach(() => {
  codeReply = reply({ data: { sent: true } });
  deleteReply = reply({ data: { success: true } });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function getCode() {
  fireEvent.click(screen.getByRole("button", { name: t.sendCode }));
  return screen.findByLabelText(t.codeLabel);
}

describe("DeleteAccountModal", () => {
  it("lets an account without a password delete itself with an emailed code", async () => {
    const { onDeleted } = open();
    expect(screen.queryByLabelText(t.passwordLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: t.usePassword })).toBeNull();

    const input = await getCode();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/profile/delete/code");
    expect(bodyOf(0)).toEqual({ locale: "en" });
    expect(screen.getByText(t.codeSent.replace("{email}", EMAIL))).toBeTruthy();

    const confirm = screen.getByRole("button", { name: t.confirm });
    fireEvent.change(input, { target: { value: "482 9" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "482 915" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirm);
    expect(await screen.findByText(t.deleted)).toBeTruthy();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/profile/delete");
    expect(bodyOf(1)).toEqual({ code: "482915" });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("says a wrong code is wrong and keeps the account", async () => {
    deleteReply = reply({ error: "The code is wrong or has expired", code: "CODE_INVALID" }, 401);
    const { onDeleted } = open();
    fireEvent.change(await getCode(), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    expect((await screen.findByRole("alert")).textContent).toBe(t.errors.codeInvalid);
    expect(screen.queryByText(t.deleted)).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("says when too many codes were asked for", async () => {
    codeReply = reply({ error: "Too many codes requested", code: "RATE_LIMIT" }, 429);
    open();
    fireEvent.click(screen.getByRole("button", { name: t.sendCode }));
    expect((await screen.findByRole("alert")).textContent).toBe(t.errors.rateLimited);
    expect(screen.queryByLabelText(t.codeLabel)).toBeNull();
  });

  it("still lets an email account use its password", async () => {
    open({ canUsePassword: true });
    fireEvent.click(screen.getByRole("button", { name: t.usePassword }));
    fireEvent.change(screen.getByLabelText(t.passwordLabel), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    expect(await screen.findByText(t.deleted)).toBeTruthy();
    expect(bodyOf(0)).toEqual({ password: "correct horse" });
  });

  it("points a wrong password to the code", async () => {
    deleteReply = reply({ error: "Password is incorrect", code: "PASSWORD_INCORRECT" }, 401);
    open({ canUsePassword: true });
    fireEvent.click(screen.getByRole("button", { name: t.usePassword }));
    fireEvent.change(screen.getByLabelText(t.passwordLabel), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    expect((await screen.findByRole("alert")).textContent).toBe(t.errors.passwordIncorrect);
    expect(screen.getByRole("button", { name: t.useCode })).toBeTruthy();
  });

  // next-intl renders a missing key as its path instead of failing.
  it("has every string, with the same placeholders, in every language", () => {
    const flat = (node: unknown, prefix = ""): Record<string, string> =>
      Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
        if (typeof v === "string") acc[prefix + k] = v;
        else Object.assign(acc, flat(v, `${prefix}${k}.`));
        return acc;
      }, {});
    const en = flat(enCommon.deleteAccount);
    const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const locale of ["es", "it", "pt"] as const) {
      const other = flat(BUNDLES[locale].deleteAccount);
      expect(Object.keys(other).sort(), locale).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(en)) {
        expect(other[key].trim().length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(slots(other[key]), `${locale} ${key}`).toBe(slots(value));
      }
    }
  });

  for (const locale of ["es", "it", "pt"] as const) {
    it(`${locale}: speaks the page's language and asks for the code in it`, async () => {
      const copy = BUNDLES[locale].deleteAccount;
      open({ locale });
      expect(screen.getByText(copy.codeIntro.replace("{email}", EMAIL))).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: copy.sendCode }));
      expect(await screen.findByLabelText(copy.codeLabel)).toBeTruthy();
      expect(bodyOf(0)).toEqual({ locale });
      expect(screen.getByRole("button", { name: copy.confirm })).toBeTruthy();
    });
  }
});
