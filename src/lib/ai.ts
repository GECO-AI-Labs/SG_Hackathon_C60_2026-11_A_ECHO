import "server-only";
import OpenAI from "openai";

/**
 * One place for every AI call. Alibaba Model Studio speaks the OpenAI API,
 * so we use the official `openai` SDK with a different base URL.
 * To switch provider or model, change .env.local only.
 */
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.DASHSCOPE_BASE_URL,
});

const MODEL = process.env.LLM_MODEL ?? "qwen4-max";
const MODEL_FAST = process.env.LLM_MODEL_FAST ?? MODEL;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-v4";
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 1024);

type Msg = { role: "system" | "user" | "assistant"; content: string };

type ChatOptions = {
  /** "smart" = drafts, insights, rules (thinking on). "fast" = tagging, short JSON (thinking off). */
  tier?: "smart" | "fast";
  temperature?: number;
  maxTokens?: number;
  /** Override thinking (default: on for "smart", off for "fast"). Off is 3–5× faster. */
  thinking?: boolean;
};

// Qwen-specific flag. Thinking improves drafts but triples latency.
type QwenExtras = { enable_thinking?: boolean };

export async function chat(messages: Msg[], opts: ChatOptions = {}): Promise<string> {
  const fast = opts.tier === "fast";
  const res = await client.chat.completions.create({
    model: fast ? MODEL_FAST : MODEL,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? (fast ? 1500 : 8000),
    enable_thinking: !fast,
  } as OpenAI.ChatCompletionCreateParamsNonStreaming & QwenExtras);
  return res.choices[0]?.message?.content?.trim() ?? "";
}

/** Ask for JSON and parse it. Throws if the model returns something unparseable. */
export async function chatJSON<T>(messages: Msg[], opts: ChatOptions = {}): Promise<T> {
  const fast = opts.tier === "fast";
  const res = await client.chat.completions.create({
    model: fast ? MODEL_FAST : MODEL,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? (fast ? 1500 : 8000), // thinking tokens count toward this limit
    response_format: { type: "json_object" },
    enable_thinking: opts.thinking ?? !fast,
  } as OpenAI.ChatCompletionCreateParamsNonStreaming & QwenExtras);
  if (res.choices[0]?.finish_reason === "length")
    throw new Error("The AI answer was cut off (max_tokens too low for this task).");
  const text = res.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}

/** Embed up to 10 texts per call (provider limit). Returns one vector per text. */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 10) {
    const batch = texts.slice(i, i + 10).map((t) => t.slice(0, 8000) || " ");
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIM,
      encoding_format: "float",
    });
    out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

/** pgvector accepts vectors as a "[0.1,0.2,…]" string through supabase-js. */
export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
