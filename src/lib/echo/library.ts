import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, toPgVector } from "@/lib/ai";

export type Hit = {
  chunk_id: number;
  material_id: string;
  title: string;
  kind: string;
  source: string;
  post_id: string | null;
  published_date: string | null;
  content: string;
  similarity: number;
};

/** Semantic search over the approved library (plus a small keyword boost). */
export async function searchLibrary(
  db: SupabaseClient,
  query: string,
  opts: { k?: number; kinds?: string[]; approvedOnly?: boolean } = {},
): Promise<Hit[]> {
  if (!query.trim()) return [];
  const [vec] = await embed([query]);
  const { data, error } = await db.rpc("match_chunks", {
    query_embedding: toPgVector(vec),
    query_text: query,
    match_count: opts.k ?? 8,
    kinds: opts.kinds ?? null,
    approved_only: opts.approvedOnly ?? true,
  });
  if (error) throw error;
  return (data ?? []) as Hit[];
}

/** Split long documents into ~1,200-character chunks on paragraph boundaries. */
export function chunkText(text: string, size = 1200): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && (cur + "\n\n" + p).length > size) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  // A single huge paragraph still gets split.
  return chunks.flatMap((c) => (c.length <= size * 1.5 ? [c] : c.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? []));
}

/** Store a material and its embedded chunks. Returns the material id. */
export async function addMaterial(
  db: SupabaseClient,
  m: {
    kind: string;
    title: string;
    body: string;
    source?: "real" | "synthetic";
    file_path?: string | null;
    library_status?: "pending" | "approved";
    created_by?: string | null;
    post_id?: string | null;
    published_date?: string | null;
  },
): Promise<string> {
  const { data, error } = await db
    .from("materials")
    .insert({
      kind: m.kind,
      title: m.title,
      body: m.body,
      source: m.source ?? "real",
      file_path: m.file_path ?? null,
      library_status: m.library_status ?? "pending",
      created_by: m.created_by ?? null,
      post_id: m.post_id ?? null,
      published_date: m.published_date ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const chunks = chunkText(m.body);
  const vectors = await embed(chunks);
  const { error: e2 } = await db.from("material_chunks").insert(
    chunks.map((content, i) => ({
      material_id: data.id,
      chunk_index: i,
      content,
      embedding: toPgVector(vectors[i]),
    })),
  );
  if (e2) throw e2;
  return data.id;
}

export type LibraryFilters = { kinds?: string[] | null; topics?: string[] | null; fromDate?: string | null };
export type LibraryHit = Hit & {
  topic: string | null; objective: string | null; objective_status: string; library_status: string;
  impressions: number | null; clicks: number | null;
};

/** Library page search: same meaning-based retrieval as drafting, plus filters and stats. One row per material. */
export async function searchLibraryPage(db: SupabaseClient, query: string, f: LibraryFilters = {}): Promise<LibraryHit[]> {
  if (!query.trim()) return [];
  const [vec] = await embed([query]);
  const { data, error } = await db.rpc("search_library", {
    query_embedding: toPgVector(vec),
    query_text: query,
    match_count: 60,
    kinds: f.kinds?.length ? f.kinds : null,
    topics: f.topics?.length ? f.topics : null,
    from_date: f.fromDate ?? null,
  });
  if (error) throw error;
  // Long documents have several chunks: keep the best chunk per material.
  const seen = new Set<string>();
  return ((data ?? []) as LibraryHit[]).filter((h) => !seen.has(h.material_id) && seen.add(h.material_id) !== undefined);
}

/** Everything the Library side panel shows about one item. */
export async function getMaterial(db: SupabaseClient, id: string) {
  const { data: m, error } = await db
    .from("materials")
    .select("id, title, kind, body, topic, objective, objective_status, library_status, source, published_date, post_id, file_path, created_at")
    .eq("id", id)
    .single();
  if (error || !m) throw new Error("Item not found");
  let post = null;
  if (m.post_id) {
    const { data } = await db
      .from("post_performance")
      .select("url, format, impressions, unique_impressions, clicks, likes, comments, shares, ctr, engagement_rate, comparable")
      .eq("post_id", m.post_id)
      .maybeSingle();
    post = data;
  }
  const { count } = await db.from("review_items").select("id", { count: "exact", head: true }).eq("item_type", "post_draft").contains("citations", [{ material_id: id }]);
  return { ...m, post, cited_in: count ?? 0 };
}
