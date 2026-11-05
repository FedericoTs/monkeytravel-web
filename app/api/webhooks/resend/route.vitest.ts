// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeAnswer, type FakeQuery } from "@/tests/fake-supabase";

/**
 * What Resend tells us about the mail we sent is what later sends obey: a bounce
 * or a complaint stops mail to that address, a complaint or a native unsubscribe
 * turns off what the person's settings say it should. Only a request Resend
 * signed gets that far. Mail to our own addresses alerts a person. The real route
 * runs with its signature check, over a fake database.
 */

const base64 = (text: string) => Buffer.from(text).toString("base64");
const SECRET_BYTES = base64("signing bytes for these tests");
vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${SECRET_BYTES}`);
vi.stubEnv("RESEND_API_KEY", "test-key");
vi.stubEnv("INBOUND_ALERT_TO", "ops@example.com");

const s = vi.hoisted(() => ({ db: null as unknown as { client: unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => s.db.client }));
const capture = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...args: unknown[]) => capture(...args) }));

const { POST } = await import("./route");

const sign = (id: string, timestamp: string, body: string, secret = SECRET_BYTES) =>
  `v1,${createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;

const now = () => String(Math.floor(Date.now() / 1000));

function signed(payload: unknown, headers: Record<string, string> = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const id = headers["svix-id"] ?? "msg_1";
  const timestamp = headers["svix-timestamp"] ?? now();
  return new NextRequest("https://monkeytravel.app/api/webhooks/resend", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": sign(id, timestamp, body),
      ...headers,
    },
    body,
  });
}

const deliver = async (payload: unknown, headers?: Record<string, string>) => {
  const res = await POST(signed(payload, headers));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

let log: FakeQuery[];
function database(answer: FakeAnswer = () => ({ data: null, error: null })) {
  const db = fakeSupabase(answer);
  s.db = db;
  log = db.log;
}
/** A database with this account, and with `logged` rows matching a message id. */
function withAccount(settings: Record<string, unknown> | null, logged: unknown[] = [{ id: "row-1" }]) {
  database((q) => {
    if (q.table === "users" && q.op === "select") {
      return { data: { id: "user-1", notification_settings: settings }, error: null };
    }
    if (q.table === "email_log" && q.op === "update") return { data: logged, error: null };
    return { data: null, error: null };
  });
}
const settingsWritten = () => log.filter((q) => q.table === "users" && q.op === "update").map((q) => q.value);
const logWrites = () => log.filter((q) => q.table === "email_log" && q.op !== "select");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  database();
  capture.mockClear();
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe("only a request Resend signed gets through", () => {
  const bounce = { type: "email.bounced", data: { email_id: "m1", to: ["a@example.com"] } };

  const refused = async (request: NextRequest, status = 401) => {
    expect((await POST(request)).status).toBe(status);
    expect(log).toEqual([]);
  };

  it("a request missing any of the headers", async () => {
    for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
      const request = signed(bounce);
      request.headers.delete(name);
      await refused(request);
    }
  });

  it("a signature made with another secret, over another body or for another message", async () => {
    const body = JSON.stringify(bounce);
    const timestamp = now();
    const forged = (signature: string) => signed(bounce, { "svix-timestamp": timestamp, "svix-signature": signature });
    await refused(forged(sign("msg_1", timestamp, body, base64("another secret"))));
    await refused(forged(sign("msg_1", timestamp, `${body} `)));
    await refused(forged(sign("msg_2", timestamp, body)));
    await refused(forged(`v1,${base64("not a signature")}`));
    await refused(forged("v2," + sign("msg_1", timestamp, body).slice(3)));
  });

  it("a signed message older than five minutes, or from the future, or with no real time", async () => {
    const at = (seconds: number) => String(Math.floor(Date.now() / 1000) + seconds);
    await refused(signed(bounce, { "svix-timestamp": at(-301) }));
    await refused(signed(bounce, { "svix-timestamp": at(301) }));
    await refused(signed(bounce, { "svix-timestamp": "soon" }));
  });

  it("takes either signature while the secret is being rotated", async () => {
    const body = JSON.stringify(bounce);
    const timestamp = now();
    const both = `${sign("msg_1", timestamp, body, base64("the old secret"))} ${sign("msg_1", timestamp, body)}`;
    const res = await POST(signed(bounce, { "svix-timestamp": timestamp, "svix-signature": both }));
    expect(res.status).toBe(200);
  });

  it("answers 400 to a signed body that isn't JSON", async () => {
    await refused(signed("not json"), 400);
  });

  it("takes nothing while the secret isn't set, or isn't one", async () => {
    const withSecret = async (secret: string) => {
      vi.resetModules();
      vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
      try {
        return (await import("./route")).POST;
      } finally {
        vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${SECRET_BYTES}`);
      }
    };
    expect((await (await withSecret(""))(signed(bounce))).status).toBe(503);
    expect((await (await withSecret(SECRET_BYTES))(signed(bounce))).status).toBe(401);
    expect((await (await withSecret(`other_${SECRET_BYTES}`))(signed(bounce))).status).toBe(401);
    expect(log).toEqual([]);
  });
});

describe("a bounce", () => {
  it("marks the logged message, which stops later sends to that address", async () => {
    withAccount(null, [{ id: "row-1", recipient_email: "a@example.com" }]);
    const { status, json } = await deliver({ type: "email.bounced", data: { email_id: "m1", to: ["a@example.com"] } });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, recorded: "bounced", rows: 1 });
    const [write] = logWrites();
    expect(write.op).toBe("update");
    expect(eqOf(write, "message_id")).toBe("m1");
    expect(write.value).toMatchObject({ status: "bounced", bounced_at: expect.any(String) });
    expect(settingsWritten()).toEqual([]);
  });

  it("with no logged message, adds a row for the bare address, so it still stops them", async () => {
    withAccount(null, []);
    const { json } = await deliver({ type: "email.bounced", data: { email_id: "m1", to: ["Jane Doe <Jane@Example.com>"] } });
    expect(json).toEqual({ ok: true, recorded: "bounced", via: "fallback" });
    const insert = logWrites().find((q) => q.op === "insert");
    expect(insert?.value).toEqual([
      {
        recipient_email: "jane@example.com",
        template_id: "unknown",
        status: "bounced",
        message_id: "m1",
        bounced_at: expect.any(String),
        metadata: { source: "resend-webhook", svix_id: "msg_1" },
      },
    ]);
  });

  it("with no message id, adds the row without looking for one", async () => {
    await deliver({ type: "email.bounced", data: { to: ["a@example.com"] } });
    expect(logWrites().map((q) => q.op)).toEqual(["insert"]);
  });

  it("adds the row when marking the logged message fails", async () => {
    database((q) =>
      q.table === "email_log" && q.op === "update" ? { data: null, error: { message: "write failed" } } : { data: null, error: null }
    );
    const { status, json } = await deliver({ type: "email.bounced", data: { email_id: "m1", to: ["a@example.com"] } });
    expect(status).toBe(200);
    expect(json).toMatchObject({ via: "fallback" });
    expect(logWrites().map((q) => q.op)).toEqual(["update", "insert"]);
  });

  it("is acknowledged even when nothing can be written, so Resend doesn't retry forever", async () => {
    database(() => ({ data: null, error: { message: "database down" } }));
    const { status } = await deliver({ type: "email.bounced", data: { email_id: "m1", to: ["a@example.com"] } });
    expect(status).toBe(200);
  });

  it("is acknowledged and reported when the write throws", async () => {
    database((q) => {
      if (q.table === "email_log") throw new Error("connection lost");
      return { data: null, error: null };
    });
    const { status, json } = await deliver({ type: "email.bounced", data: { email_id: "m1", to: ["a@example.com"] } });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, error: "internal" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("with neither a message id nor an address writes nothing", async () => {
    await deliver({ type: "email.bounced", data: {} });
    expect(log).toEqual([]);
  });

  it("changes no one's settings", async () => {
    await deliver({ type: "email.bounced", data: { email_id: "m1", to: ["a@example.com"] } });
    expect(log.filter((q) => q.table === "users")).toEqual([]);
  });
});

describe("a spam complaint", () => {
  const complaint = { type: "email.complained", data: { email_id: "m1", to: ["Jane <jane@example.com>"] } };

  it("turns all mail off for the account, keeping its other settings, and marks the message", async () => {
    withAccount({ marketingNotifications: true, collabVotes: true });
    const { json } = await deliver(complaint);
    expect(settingsWritten()).toEqual([
      { notification_settings: { marketingNotifications: true, collabVotes: true, emailNotifications: false } },
    ]);
    expect(log.find((q) => q.table === "users")?.filters).toContainEqual(["ilike", "email", "jane@example.com"]);
    expect(eqOf(log.find((q) => q.table === "users" && q.op === "update")!, "id")).toBe("user-1");
    expect(json).toEqual({ ok: true, recorded: "complained", rows: 1 });
    expect(logWrites()[0].value).toMatchObject({ status: "complained", complained_at: expect.any(String) });
  });

  it("reaches the master switch even when marketing was already off", async () => {
    withAccount({ marketingNotifications: false });
    await deliver(complaint);
    expect(settingsWritten()).toEqual([{ notification_settings: { marketingNotifications: false, emailNotifications: false } }]);
  });

  it("writes nothing when all mail is already off", async () => {
    withAccount({ emailNotifications: false });
    await deliver(complaint);
    expect(settingsWritten()).toEqual([]);
  });

  it("applies to every address the message went to", async () => {
    withAccount({});
    await deliver({ type: "email.complained", data: { email_id: "m1", to: ["a@example.com", "b@example.com"] } });
    expect(settingsWritten()).toHaveLength(2);
  });

  it("still marks the message when the address has no account, or the account can't be read", async () => {
    database((q) => (q.table === "email_log" && q.op === "update" ? { data: [{ id: "row-1" }], error: null } : { data: null, error: null }));
    expect((await deliver(complaint)).json).toMatchObject({ recorded: "complained" });

    database((q) =>
      q.table === "users"
        ? { data: null, error: { message: "read failed" } }
        : q.op === "update"
          ? { data: [{ id: "row-1" }], error: null }
          : { data: null, error: null }
    );
    expect((await deliver(complaint)).json).toMatchObject({ recorded: "complained" });
    expect(settingsWritten()).toEqual([]);
  });
});

describe("an unsubscribe made in Resend", () => {
  const LIFECYCLE_OFF = expect.objectContaining({ marketingNotifications: false, tripReminders: false });

  it("stops the whole automated trip stream, keeping other settings", async () => {
    withAccount({ collabVotes: true });
    const { json } = await deliver({ type: "contact.updated", data: { email: "a@example.com", unsubscribed: true } });
    const [written] = settingsWritten() as Array<{ notification_settings: Record<string, unknown> }>;
    expect(written.notification_settings).toEqual(LIFECYCLE_OFF);
    expect(written.notification_settings.collabVotes).toBe(true);
    expect(written.notification_settings.emailNotifications).toBeUndefined();
    expect(json).toEqual({ recorded: "marketing_opt_out", ok: true });
  });

  it("counts a deleted contact as one", async () => {
    withAccount({});
    await deliver({ type: "contact.deleted", data: { email: "a@example.com" } });
    expect(settingsWritten()).toHaveLength(1);
  });

  it("ignores a contact update that isn't an unsubscribe, and one with no address", async () => {
    withAccount({});
    expect((await deliver({ type: "contact.updated", data: { email: "a@example.com", unsubscribed: false } })).json).toEqual({
      ok: true,
      ignored: "contact.updated",
    });
    expect((await deliver({ type: "contact.deleted", data: {} })).json).toEqual({ ok: true, ignored: "contact.deleted" });
    expect(log).toEqual([]);
  });

  it("says what went wrong when the address has no account, or the write fails", async () => {
    database();
    expect((await deliver({ type: "contact.deleted", data: { email: "a@example.com" } })).json).toMatchObject({
      ok: false,
      reason: "no matching user",
    });

    database((q) =>
      q.op === "update"
        ? { data: null, error: { message: "write failed" } }
        : { data: { id: "user-1", notification_settings: {} }, error: null }
    );
    expect((await deliver({ type: "contact.deleted", data: { email: "a@example.com" } })).json).toMatchObject({
      ok: false,
      reason: "write failed",
    });

    database(() => ({ data: null, error: { message: "read failed" } }));
    expect((await deliver({ type: "contact.deleted", data: { email: "a@example.com" } })).json).toMatchObject({
      ok: false,
      reason: "read failed",
    });
  });
});

describe("an open", () => {
  it("is recorded once, on the message it was for", async () => {
    const { json } = await deliver({ type: "email.opened", data: { email_id: "m1" } });
    expect(json).toEqual({ ok: true, recorded: "opened" });
    const [write] = logWrites();
    expect(write.value).toEqual({ opened_at: expect.any(String) });
    expect(write.filters).toEqual([
      ["eq", "message_id", "m1"],
      ["is", "opened_at", null],
    ]);
  });

  it("with no message id writes nothing", async () => {
    await deliver({ type: "email.opened", data: {} });
    expect(log).toEqual([]);
  });
});

describe("events it has no use for", () => {
  it.each(["email.sent", "email.delivered", "email.clicked", "email.delivery_delayed", "something.new"])(
    "%s is acknowledged and writes nothing",
    async (type) => {
      expect(await deliver({ type, data: { email_id: "m1", to: ["a@example.com"] } })).toEqual({
        status: 200,
        json: { ok: true, ignored: type },
      });
      expect(log).toEqual([]);
    }
  );
});

describe("mail to our own addresses", () => {
  const inbound = {
    type: "email.received",
    data: { from: "Jane <jane@example.com>", to: ["privacy@monkeytravel.app"], subject: "Delete my data", text: "Please delete it." },
  };
  const alert = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;

  it("alerts a person, with the sender to reply to, the address it came to and the message", async () => {
    expect((await deliver(inbound)).json).toEqual({ ok: true, alerted: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(alert()).toMatchObject({
      to: ["ops@example.com"],
      reply_to: "Jane <jane@example.com>",
      subject: "[inbox] privacy@monkeytravel.app: Delete my data",
    });
    expect(alert().text).toContain("Please delete it.");
  });

  it("goes to the first admin when no alert address is set, and is acknowledged when there's neither", async () => {
    vi.stubEnv("INBOUND_ALERT_TO", "");
    vi.stubEnv("ADMIN_EMAILS", "first@example.com,second@example.com");
    try {
      await deliver(inbound);
      expect(alert().to).toEqual(["first@example.com"]);

      vi.stubEnv("ADMIN_EMAILS", "");
      fetchMock.mockClear();
      expect((await deliver(inbound)).json).toEqual({ ok: true, alerted: false, reason: "no recipient" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("INBOUND_ALERT_TO", "ops@example.com");
    }
  });

  it("keeps the alert within what a mail can carry", async () => {
    await deliver({ ...inbound, data: { ...inbound.data, subject: "x".repeat(400), text: `${"y".repeat(3000)}TAIL` } });
    expect(String(alert().subject).length).toBe(180);
    expect(alert().text).not.toContain("TAIL");
  });

  it("doesn't alert on our own mail coming back, so it can't loop", async () => {
    const own = { ...inbound, data: { ...inbound.data, from: "MonkeyTravel <noreply@monkeytravel.app>" } };
    expect((await deliver(own)).json).toEqual({ ok: true, ignored: "inbound_self" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't alert on the daily DMARC reports", async () => {
    const report = { ...inbound, data: { ...inbound.data, to: ["dmarc@monkeytravel.app"] } };
    expect((await deliver(report)).json).toEqual({ ok: true, ignored: "dmarc_report" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("acknowledges an alert that couldn't go, so Resend doesn't retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect((await deliver(inbound)).json).toEqual({ ok: true, alerted: false, status: 500 });

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await deliver(inbound)).toEqual({ status: 200, json: { ok: true, alerted: false } });
  });

  it("acknowledges when there's no key to send with", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    try {
      expect((await deliver(inbound)).json).toEqual({ ok: true, alerted: false, reason: "no api key" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("RESEND_API_KEY", "test-key");
    }
  });
});
