// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Anyone can send a message with no account, so the route's checks and rate limit
 * are all that protect the table and the admins' inboxes. The real route, validation,
 * admin list and in-memory rate limiter run; the Supabase clients and sending are faked.
 */

const ADMINS = ["admin@mail.example.com", "second@mail.example.com"];
const MESSAGE = { name: "Pat", email: "person@mail.example.com", topic: "support", message: "My trip won't load today." };

interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

const s = vi.hoisted(() => ({
  ip: "",
  insert: { data: null as unknown, error: null as unknown },
  noServiceKey: false,
  sent: [] as SentEmail[],
  sendFails: false,
  handedToAfter: 0,
}));

// The limiter is real, on its in-memory store: nothing here reaches Redis.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = async () => {
      throw new Error("no Redis in tests");
    };
  },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    s.handedToAfter++;
    void task();
  },
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: async (email: SentEmail) => {
    s.sent.push(email);
    if (s.sendFails) throw new Error("mail is down");
    return { ok: true };
  },
}));

const answer = (q: FakeQuery) => (q.op === "insert" ? s.insert : { data: null, error: null });
const service = fakeSupabase(answer);
const anon = fakeSupabase(answer);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (s.noServiceKey) throw new Error("Missing Supabase admin credentials");
    return service.client;
  },
}));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return anon.client;
  },
}));

const { POST } = await import("./route");

const send = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": s.ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
const row = () => service.log[0]?.value as Record<string, unknown>;
const nothingHappened = () => {
  expect(service.log).toEqual([]);
  expect(s.sent).toEqual([]);
};
const allSent = () => vi.waitFor(() => expect(s.sent).toHaveLength(ADMINS.length));

let requests = 0;
beforeEach(() => {
  // The limiter counts per address, so each test comes from its own.
  s.ip = `203.0.113.${++requests}`;
  s.insert = { data: { id: "msg-1" }, error: null };
  s.noServiceKey = false;
  s.sent = [];
  s.sendFails = false;
  s.handedToAfter = 0;
  service.log.length = 0;
  anon.log.length = 0;
  vi.stubEnv("ADMIN_EMAILS", ADMINS.join(","));
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a message", () => {
  it("writes one tidied row, keeping only a hash of the sender's IP, and answers its id", async () => {
    const res = await send(
      { ...MESSAGE, name: "  Pat  ", email: " Person@Mail.Example.com ", message: `  ${MESSAGE.message}  `, locale: "pt-BR-long-tag" },
      { "x-forwarded-for": "198.51.100.7, 10.0.0.1", "user-agent": "u".repeat(600), referer: "r".repeat(600) }
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "msg-1" });
    expect(service.log).toHaveLength(1);
    expect(service.log[0]).toMatchObject({ table: "contact_messages", op: "insert" });
    expect(row()).toEqual({
      name: "Pat",
      email: MESSAGE.email,
      topic: "support",
      message: MESSAGE.message,
      locale: "pt-BR-lo",
      user_agent: "u".repeat(500),
      referer: "r".repeat(500),
      ip_hash: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(JSON.stringify(row())).not.toContain("198.51.100.7");
    await allSent();
  });

  it("tells every admin, with Reply-To set to the sender", async () => {
    await send(MESSAGE);
    await allSent();
    expect(s.sent.map((email) => email.to)).toEqual(ADMINS);
    for (const email of s.sent) {
      expect(email.subject).toBe("[support] Pat — monkeytravel contact");
      expect(email.headers).toEqual({ "Reply-To": MESSAGE.email });
      expect(email.text).toContain(MESSAGE.message);
    }
  });

  it("escapes what the sender wrote in the email's HTML", async () => {
    await send({ ...MESSAGE, name: "<script>alert(1)</script>", message: 'Hello "there" & <img src=x onerror=alert(1)>' });
    await allSent();
    const { html } = s.sent[0];
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;there&quot; &amp;");
  });

  it("marks a partner's domain as VIP, and only that", async () => {
    await send({ ...MESSAGE, email: "test-partner@booking.com" });
    await allSent();
    expect(s.sent[0].subject.startsWith("[VIP] ")).toBe(true);
    expect(s.sent[0].tags).toContainEqual({ name: "vip", value: "booking.com" });

    s.sent = [];
    await send(MESSAGE);
    await allSent();
    expect(s.sent[0].subject).not.toContain("VIP");
    expect(s.sent[0].html).not.toContain("VIP");
  });

  it("still goes through the public client when the service credentials are missing", async () => {
    s.noServiceKey = true;
    expect((await send(MESSAGE)).status).toBe(201);
    expect(anon.log.map((q) => [q.table, q.op])).toEqual([["contact_messages", "insert"]]);
    await allSent();
  });
});

describe("what it refuses", () => {
  it.each<[string, unknown, string]>([
    ["a body that isn't JSON", "{not json", "Invalid request body"],
    ["a blank name", { ...MESSAGE, name: "   " }, "Invalid name"],
    ["a name over 200 characters", { ...MESSAGE, name: "n".repeat(201) }, "Invalid name"],
    ["a malformed address", { ...MESSAGE, email: "not-an-address" }, "Invalid email"],
    ["a topic not on the list", { ...MESSAGE, topic: "spam" }, "Invalid topic"],
    ["a message under 10 characters", { ...MESSAGE, message: "   too short   " }, "Invalid message"],
    ["a message over 5000 characters", { ...MESSAGE, message: "m".repeat(5001) }, "Invalid message"],
  ])("%s, writing and sending nothing", async (_name, body, error) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    nothingHappened();
  });

  it("takes a name and a message right at their limits", async () => {
    expect((await send({ ...MESSAGE, name: "n".repeat(200), message: "m".repeat(5000) })).status).toBe(201);
    await allSent();
  });

  it("stops the sixth message in an hour from one address, writing and sending nothing", async () => {
    for (let i = 0; i < 5; i++) await send({ ...MESSAGE, topic: "not on the list" });
    const res = await send(MESSAGE);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMIT");
    nothingHappened();
  });

  it("cuts an oversized locale in the admin email, as it does in the row", async () => {
    await send({ ...MESSAGE, locale: "x".repeat(1_000_000) });
    await allSent();
    expect(s.sent[0].text.length).toBeLessThan(10_000);
  });

  it("takes line breaks out of a name before it goes in the subject", async () => {
    await send({ ...MESSAGE, name: "Pat\r\nBcc: someone@mail.example.com" });
    await allSent();
    expect(s.sent[0].subject).not.toMatch(/[\r\n]/);
  });

  it("stores a hash of the IP that hashing every address can't reverse", async () => {
    await send(MESSAGE, { "x-forwarded-for": "198.51.100.7" });
    await allSent();
    expect(row().ip_hash).not.toBe(createHash("sha256").update("198.51.100.7").digest("hex").slice(0, 32));
  });
});

describe("when something fails", () => {
  it("answers 500 and tells no admin when the row can't be written", async () => {
    s.insert = { data: null, error: { message: "write failed" } };
    const res = await send(MESSAGE);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to send message. Please try again." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.sent).toEqual([]);
  });

  it("still answers 201 when the message is kept but the email fails, or no admin is set", async () => {
    s.sendFails = true;
    expect((await send(MESSAGE)).status).toBe(201);
    await allSent();

    s.sent = [];
    vi.stubEnv("ADMIN_EMAILS", "");
    expect((await send(MESSAGE)).status).toBe(201);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(expect.stringContaining("no ADMIN_EMAILS"), "msg-1", "notified nobody"));
    expect(s.sent).toEqual([]);
  });

  it("hands the admin email to after(), so it outlives the response on a serverless function", async () => {
    await send(MESSAGE);
    expect(s.handedToAfter).toBe(1);
  });
});
