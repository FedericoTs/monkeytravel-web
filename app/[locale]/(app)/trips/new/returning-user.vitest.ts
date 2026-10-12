// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The planner's welcome-back banner is decided on the server, so it is in the
 * first paint. The trips count runs while the auth server confirms who is
 * asking, and the wizard is told which user was counted so the browser does
 * not count the same trips again.
 */

const ME = "me-1";
const token = `h.${Buffer.from(JSON.stringify({ sub: ME })).toString("base64url")}.sig`;

let signedIn: boolean;
let confirmed: boolean;
let authAnswered: Promise<void>;
let countAnswer: { count: number | null; error: unknown };
const sent: string[] = [];
const getUserCalls: unknown[] = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: signedIn ? { access_token: token } : null } }),
      getUser: async (jwt?: string) => {
        getUserCalls.push(jwt);
        await authAnswered;
        return { data: { user: confirmed ? { id: ME } : null } };
      },
    },
    from: (table: string) => ({
      select: () => ({
        // Like the real builder, the query is sent only once something awaits it.
        eq: () => ({
          then: (resolve: (v: unknown) => unknown) => {
            sent.push(table);
            return Promise.resolve(countAnswer).then(resolve);
          },
        }),
      }),
    }),
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/destinations/data", () => ({ getDestinationBySlug: () => undefined }));
vi.mock("./NewTripWizard", () => ({ default: () => null }));

type WizardProps = { returningUser?: boolean; returningUserCheckedFor?: string | null };

async function wizardProps(): Promise<WizardProps> {
  const { default: NewTripPage } = await import("./page");
  const el = (await NewTripPage({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve({}),
  })) as { props: WizardProps };
  return el.props;
}

beforeEach(() => {
  signedIn = true;
  confirmed = true;
  authAnswered = Promise.resolve();
  countAnswer = { count: 3, error: null };
  sent.length = 0;
  getUserCalls.length = 0;
});

describe("the planner's welcome-back banner", () => {
  it("counts the trips while the auth server confirms who is asking", async () => {
    let answer = () => {};
    authAnswered = new Promise<void>((resolve) => (answer = resolve));
    const props = wizardProps();
    await vi.waitFor(() => expect(sent).toEqual(["trips"]), { timeout: 5000 });
    answer();
    expect((await props).returningUser).toBe(true);
  });

  it("tells the wizard whom it counted for, so the browser does not count again", async () => {
    expect(await wizardProps()).toMatchObject({ returningUser: true, returningUserCheckedFor: ME });
    countAnswer = { count: 0, error: null };
    expect(await wizardProps()).toMatchObject({ returningUser: false, returningUserCheckedFor: ME });
  });

  it("a cookie the auth server does not confirm gets no banner", async () => {
    confirmed = false;
    expect(await wizardProps()).toMatchObject({ returningUser: false, returningUserCheckedFor: null });
  });

  it("a failed count leaves the question to the browser", async () => {
    countAnswer = { count: null, error: { message: "timeout" } };
    expect(await wizardProps()).toMatchObject({ returningUser: false, returningUserCheckedFor: null });
  });

  it("anonymous visitors cost no round trip", async () => {
    signedIn = false;
    expect(await wizardProps()).toMatchObject({ returningUser: false, returningUserCheckedFor: null });
    expect(sent).toEqual([]);
    expect(getUserCalls).toEqual([]);
  });
});
