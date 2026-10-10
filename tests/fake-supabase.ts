/**
 * A stand-in for the service-role client in route tests. Every query is
 * recorded, and `answer` decides what each one returns.
 */
export interface FakeQuery {
  /** The table, or the function name for an rpc. */
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc";
  value?: unknown;
  filters: Array<[op: "eq" | "neq" | "is" | "not" | "in" | "lte" | "gte", column: string, value: unknown]>;
  /** How the query was awaited: a single row, or the whole list. */
  end: "single" | "maybeSingle" | "list";
}

export type FakeAnswer = (q: FakeQuery) => { data: unknown; error: unknown };

/** The value a query filtered `column` on with `.eq()`. */
export const eqOf = (q: FakeQuery, column: string): unknown => q.filters.find(([op, c]) => op === "eq" && c === column)?.[2];

export function fakeSupabase(answer: FakeAnswer = () => ({ data: null, error: null })) {
  const log: FakeQuery[] = [];
  const from = (table: string) => {
    const q: FakeQuery = { table, op: "select", filters: [], end: "list" };
    const done = (end: FakeQuery["end"]) => {
      q.end = end;
      log.push(q);
      return answer(q);
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (v: unknown) => ((q.op = "insert"), (q.value = v), chain),
      update: (v: unknown) => ((q.op = "update"), (q.value = v), chain),
      upsert: (v: unknown) => ((q.op = "upsert"), (q.value = v), chain),
      delete: () => ((q.op = "delete"), chain),
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), chain),
      neq: (c: string, v: unknown) => (q.filters.push(["neq", c, v]), chain),
      is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), chain),
      not: (c: string, op: string, v: unknown) => (q.filters.push(["not", c, [op, v]]), chain),
      in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), chain),
      lte: (c: string, v: unknown) => (q.filters.push(["lte", c, v]), chain),
      gte: (c: string, v: unknown) => (q.filters.push(["gte", c, v]), chain),
      order: () => chain,
      limit: () => chain,
      single: async () => done("single"),
      maybeSingle: async () => done("maybeSingle"),
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(done("list")).then(resolve, reject),
    };
    return chain;
  };
  const rpc = async (fn: string, args: unknown) => {
    const q: FakeQuery = { table: fn, op: "rpc", value: args, filters: [], end: "single" };
    log.push(q);
    return answer(q);
  };
  const client = { from, rpc, channel: () => ({ httpSend: async () => undefined }) };
  return { client, log };
}
