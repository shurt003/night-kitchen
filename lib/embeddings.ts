import { EMBEDDING_MODEL } from "./config";

// Semantic search embeddings via Voyage AI (Anthropic's recommended embeddings
// partner — Anthropic's own API has no embeddings endpoint). Optional: when
// VOYAGE_API_KEY is unset every function returns null and the app falls back
// to keyword (trigram) search.

export async function embed(
  text: string,
  inputType: "document" | "query"
): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: [text.slice(0, 8000)],
        input_type: inputType,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/** The text a recipe is embedded over: title + description + main ingredients + my notes. */
export function recipeEmbeddingText(r: {
  title: string;
  description: string;
  main_ingredients: string[];
  notes: string;
  tags: string[];
  cuisine: string | null;
}): string {
  return [r.title, r.description, r.cuisine ?? "", r.main_ingredients.join(", "), r.tags.join(", "), r.notes]
    .filter(Boolean)
    .join("\n");
}
