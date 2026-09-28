import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContent = vi.fn();
const generateContentStream = vi.fn();
const sendMessage = vi.fn();
const sendMessageStream = vi.fn();
const create = vi.fn(() => ({ sendMessage, sendMessageStream }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream };
    chats = { create };
    constructor(public opts: { apiKey?: string }) {}
  },
  Type: { STRING: "STRING", NUMBER: "NUMBER", INTEGER: "INTEGER", BOOLEAN: "BOOLEAN", ARRAY: "ARRAY", OBJECT: "OBJECT" },
}));

import { GoogleGenerativeAI, SchemaType } from "./genai-compat";

const usage = { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150, cachedContentTokenCount: 100 };
async function* chunks(...texts: string[]) {
  for (const [i, text] of texts.entries()) {
    yield { text, usageMetadata: i === texts.length - 1 ? usage : undefined, candidates: [{ finishReason: "STOP" }] };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  generateContent.mockResolvedValue({ text: '{"ok":true}', usageMetadata: usage, candidates: [{ finishReason: "STOP" }] });
  sendMessage.mockResolvedValue({ text: "hello", usageMetadata: usage, candidates: [] });
});

describe("GoogleGenerativeAI compatibility layer", () => {
  it("turns a prompt string into a user turn and the generation config into the SDK config", async () => {
    const model = new GoogleGenerativeAI("key").getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0.4, maxOutputTokens: 100, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    });
    const result = await model.generateContent("plan a day");
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "plan a day" }] }],
      config: { temperature: 0.4, maxOutputTokens: 100, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(result.response.text()).toBe('{"ok":true}');
    expect(result.response.usageMetadata).toEqual(usage);
    expect(result.response.candidates?.[0]?.finishReason).toBe("STOP");
  });

  it("passes explicit contents through, with a per-call config override", async () => {
    const model = new GoogleGenerativeAI("key").getGenerativeModel({ model: "m", generationConfig: { temperature: 1 } });
    const contents = [{ role: "user", parts: [{ text: "a" }] }, { role: "model", parts: [{ text: "b" }] }];
    await model.generateContent({ contents, generationConfig: { temperature: 0.2 } });
    expect(generateContent.mock.calls[0][0]).toEqual({ model: "m", contents, config: { temperature: 0.2 } });
  });

  it("answers an empty string, not a throw, when the model returned no text", async () => {
    generateContent.mockResolvedValueOnce({ text: undefined, candidates: [{ finishReason: "SAFETY" }] });
    const model = new GoogleGenerativeAI("key").getGenerativeModel({ model: "m" });
    const result = await model.generateContent("x");
    expect(result.response.text()).toBe("");
    expect(generateContent.mock.calls[0][0].config).toBeUndefined();
  });

  it("a chat keeps its history and sends messages the way the SDK expects", async () => {
    const model = new GoogleGenerativeAI("key").getGenerativeModel({ model: "m", generationConfig: { topK: 40 } });
    const history = [{ role: "user", parts: [{ text: "system prompt" }] }, { role: "model", parts: [{ text: "ok" }] }];
    const chat = model.startChat({ history });
    expect(create).toHaveBeenCalledWith({ model: "m", history, config: { topK: 40 } });
    const result = await chat.sendMessage("hi");
    expect(sendMessage).toHaveBeenCalledWith({ message: "hi" });
    expect(result.response.text()).toBe("hello");
  });

  it("streams chunk by chunk and then resolves the whole response", async () => {
    sendMessageStream.mockResolvedValue(chunks("{", '"a":1', "}"));
    const chat = new GoogleGenerativeAI("key").getGenerativeModel({ model: "m" }).startChat();
    const result = chat.sendMessageStream("go");
    const seen: string[] = [];
    for await (const chunk of result.stream) seen.push(chunk.text());
    expect(seen).toEqual(["{", '"a":1', "}"]);
    const whole = await result.response;
    expect(whole.text()).toBe('{"a":1}');
    expect(whole.usageMetadata).toEqual(usage);
  });

  it("model streaming works the same way", async () => {
    generateContentStream.mockResolvedValue(chunks("one ", "two"));
    const model = new GoogleGenerativeAI("key").getGenerativeModel({ model: "m" });
    const result = model.generateContentStream({ contents: [{ role: "user", parts: [{ text: "x" }] }] });
    let text = "";
    for await (const chunk of result.stream) text += chunk.text();
    expect(text).toBe("one two");
    expect((await result.response).text()).toBe("one two");
  });

  it("keeps the schema type names the call sites use", () => {
    expect(SchemaType.OBJECT).toBe("OBJECT");
    expect(SchemaType.ARRAY).toBe("ARRAY");
    expect(SchemaType.STRING).toBe("STRING");
  });
});
