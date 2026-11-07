import { describe, expect, it } from "vitest";
import { readsSky } from "./result-sky";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("the sky, when asked for", () => {
  it("is off unless asked for", () => {
    expect(readsSky(null, memoryStore())).toBe(false);
    expect(readsSky("control", memoryStore())).toBe(false);
  });

  it("stays on in this browser once asked for, until asked to go back", () => {
    const store = memoryStore();
    expect(readsSky("sky", store)).toBe(true);
    expect(readsSky(null, store)).toBe(true);
    expect(readsSky("classic", store)).toBe(false);
    expect(readsSky(null, store)).toBe(false);
  });

  it("still works for the page when storage is refused", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(readsSky("sky", refusing)).toBe(true);
    expect(readsSky(null, refusing)).toBe(false);
  });
});
