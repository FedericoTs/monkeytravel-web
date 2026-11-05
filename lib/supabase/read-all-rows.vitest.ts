import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";
import { PAGE_ROWS, readAllRows, readWholeTable } from "./read-all-rows";

type Row = { id: string; at: number };

/** Answers as PostgREST does: at most a page, whatever was asked for. */
const pageFrom = (rows: Row[], last: Row | null) => {
  const from = last ? rows.findIndex((row) => row.at === last.at) : 0;
  return { data: rows.slice(from, from + PAGE_ROWS), error: null };
};
const numbered = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `row-${String(i).padStart(6, "0")}`, at: i }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readAllRows", () => {
  it("reads past what one request answers", async () => {
    const rows = numbered(PAGE_ROWS * 2 + 500);
    const { data, error } = await readAllRows<Row>(async (last) => pageFrom(rows, last));
    expect(error).toBeNull();
    expect(data).toEqual(rows);
  });

  it("reads a table that fits one page, and an empty one", async () => {
    const rows = numbered(3);
    expect((await readAllRows<Row>(async (last) => pageFrom(rows, last))).data).toEqual(rows);
    expect((await readAllRows<Row>(async () => ({ data: [], error: null }))).data).toEqual([]);
    expect((await readAllRows<Row>(async () => ({ data: null, error: null }))).data).toEqual([]);
  });

  it("keeps rows that share a key across two pages, and counts each once", async () => {
    // Rows logged in one batch share a timestamp, and a page can end among them.
    const rows = [...numbered(PAGE_ROWS - 1), { id: "b", at: 5000 }, { id: "c", at: 5000 }, { id: "d", at: 5000 }, { id: "e", at: 6000 }];
    const { data } = await readAllRows<Row>(async (last) => pageFrom(rows, last));
    expect(data?.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it("copes with a server that answers smaller pages", async () => {
    const rows = numbered(25);
    const { data } = await readAllRows<Row>(async (last) => {
      const from = last ? rows.findIndex((row) => row.at === last.at) : 0;
      return { data: rows.slice(from, from + 10), error: null };
    });
    expect(data).toEqual(rows);
  });

  it("hands back the failure, and no rows, when a page fails", async () => {
    const rows = numbered(PAGE_ROWS + 5);
    const failure = { message: "statement timeout", code: "57014" };
    const result = await readAllRows<Row>(async (last) => (last ? { data: null, error: failure } : pageFrom(rows, last)));
    expect(result).toEqual({ data: null, error: failure });
  });

  it("stops at its limit and says so", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = numbered(203_000);
    const { data } = await readAllRows<Row>(async (last) => ({ data: rows.slice(last?.at ?? 0, (last?.at ?? 0) + PAGE_ROWS), error: null }));
    expect(data?.length).toBeGreaterThanOrEqual(200_000);
    expect(data?.length).toBeLessThan(201_000);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("says so when more than a page of rows share a key, which it can't get past", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = numbered(PAGE_ROWS + 50).map((row) => ({ ...row, at: 7 }));
    const { data } = await readAllRows<Row>(async () => ({ data: rows.slice(0, PAGE_ROWS), error: null }));
    expect(data).toHaveLength(PAGE_ROWS);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe("readWholeTable", () => {
  it("goes through the table by id, asking on from the last row", async () => {
    const rows = numbered(PAGE_ROWS + 2);
    const db = fakeSupabase((q) => {
      const from = q.filters.find(([op, column]) => op === "gte" && column === "id")?.[2];
      return { data: rows.filter((row) => !from || row.id >= (from as string)).slice(0, q.limitTo), error: null };
    });
    const { data } = await readWholeTable<Row>(db.client as never, "trips", "id, at");
    expect(data).toEqual(rows);
    expect(db.log[0]).toMatchObject({ table: "trips", columns: "id, at", limitTo: PAGE_ROWS, orderBy: ["id"] });
    expect(db.log[1].filters).toEqual([["gte", "id", rows[PAGE_ROWS - 1].id]]);
  });
});
