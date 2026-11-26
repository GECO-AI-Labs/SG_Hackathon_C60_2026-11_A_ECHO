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
