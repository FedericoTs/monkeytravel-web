import type { SupabaseClient } from "@supabase/supabase-js";

/** The most rows PostgREST answers one request with, whatever `.limit()` asks for. */
export const PAGE_ROWS = 1000;
/** Past this a number needs a sum in SQL, not rows in a function's memory. */
const MAX_ROWS = 200_000;

type RowsResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

/**
 * Every row of a read. PostgREST stops at 1,000 rows per request and doesn't say so,
 * so a plain select over a table that has grown quietly becomes a sample.
 *
 * `readPage` gets the last row read, null at first, and reads on from that row,
 * including it, in the order it sets. Going by key rather than by offset, a page deep
 * into a big table costs what the first one does. A row read twice counts once, so
 * rows that share a key across two pages all arrive.
 */
export async function readAllRows<T extends { id: string }>(
  readPage: (last: T | null) => PromiseLike<RowsResult<T>>
): Promise<RowsResult<T>> {
  const seen = new Set<string>();
  const rows: T[] = [];
  let last: T | null = null;
  for (;;) {
    const { data, error }: RowsResult<T> = await readPage(last);
    if (error) return { data: null, error };
    const fresh = (data ?? []).filter((row) => !seen.has(row.id));
    if (fresh.length === 0) {
      if ((data?.length ?? 0) >= PAGE_ROWS) console.error("[read all rows] stopped: more than a page of rows share a key");
      return { data: rows, error: null };
    }
    for (const row of fresh) {
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length >= MAX_ROWS) {
      console.error(`[read all rows] stopped at ${MAX_ROWS} rows: this number needs a sum in SQL`);
      return { data: rows, error: null };
    }
    last = fresh[fresh.length - 1];
  }
}

/** Every row of a table, by id. `columns` must include `id`. */
export function readWholeTable<T extends { id: string }>(
  db: SupabaseClient,
  table: string,
  columns: string
): Promise<RowsResult<T>> {
  return readAllRows<T>((last) => {
    const rows = db.from(table).select(columns);
    return (last ? rows.gte("id", last.id) : rows).order("id").limit(PAGE_ROWS) as unknown as PromiseLike<RowsResult<T>>;
  });
}
