// One-shot seeder for public.geo_cities from GeoNames cities5000 (CC-BY 4.0).
//
// Idempotent UPSERT of public city reference data. Fetches + unzips + parses
// server-side so the ~69k rows never transit a client. Invoke once, then it can
// be stubbed/removed (task #372). Deployed with verify_jwt=true; invoke with the
// anon key as Bearer. Runs with the auto-injected SERVICE_ROLE key internally.
//
//   POST /functions/v1/seed-geo-cities            -> full seed
//   POST /functions/v1/seed-geo-cities?limit=2000 -> partial (smoke test)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const LATIN = /^[a-z][a-z0-9 '().-]{1,58}$/;

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const res = await fetch(
      "https://download.geonames.org/export/dump/cities5000.zip",
    );
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `geonames ${res.status}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const txt = strFromU8(files["cities5000.txt"]);
    const lines = txt.split("\n");

    // GeoNames dump columns (tab-sep, headerless): 0 id, 1 name, 2 asciiname,
    // 3 alternatenames, 4 lat, 5 lon, 7 feature_code, 8 country_code,
    // 10 admin1, 14 population.
    const rows: Record<string, unknown>[] = [];
    for (const line of lines) {
      if (!line) continue;
      const c = line.split("\t");
      const id = Number(c[0]);
      if (!id || !c[1] || !c[2] || !c[8]) continue;
      const name = c[1];
      const ascii = c[2];
      const seen = new Set<string>();
      const toks: string[] = [];
      for (const t of [norm(name), norm(ascii)]) {
        if (t && !seen.has(t)) { seen.add(t); toks.push(t); }
      }
      let extra = 0;
      for (const a of (c[3] || "").split(",")) {
        if (extra >= 20) break;
        const n = norm(a);
        if (n.length < 2 || n.length > 58 || !LATIN.test(n) || seen.has(n)) continue;
        seen.add(n); toks.push(n); extra++;
      }
      rows.push({
        id,
        name,
        ascii_name: ascii,
        country_code: c[8],
        admin1: c[10] || null,
        latitude: c[4] ? Number(c[4]) : null,
        longitude: c[5] ? Number(c[5]) : null,
        population: c[14] ? Number(c[14]) : 0,
        feature_code: c[7] || null,
        search_text: toks.join(" "),
      });
      if (limit && rows.length >= Number(limit)) break;
    }

    let inserted = 0;
    const B = 1000;
    for (let i = 0; i < rows.length; i += B) {
      const batch = rows.slice(i, i + B);
      const { error } = await supabase.from("geo_cities").upsert(batch, { onConflict: "id" });
      if (error) {
        return new Response(JSON.stringify({ error: error.message, inserted }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      inserted += batch.length;
    }
    return new Response(JSON.stringify({ ok: true, parsed: rows.length, inserted }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
