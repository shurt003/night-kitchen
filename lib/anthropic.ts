import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { db } from "./db";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

async function logUsage(
  feature: string,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
  userId?: string | null
) {
  try {
    await db().from("usage").insert({
      feature,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      user_id: userId ?? null,
    });
  } catch {
    // usage logging must never break the feature
  }
}

/**
 * Stream a plain-text reply, yielding text as it arrives. Usage is logged once
 * the stream finishes. For conversational features where the answer is prose,
 * not schema-validated JSON — the token-by-token variant of `askJson`.
 */
export async function* streamText(opts: {
  feature: string;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  userId?: string | null;
}): AsyncGenerator<string> {
  const { feature, model, system, messages, maxTokens = 1024, userId } = opts;

  const stream = anthropic().messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  await logUsage(feature, model, final.usage, userId);
}

/** Extract the first JSON object/array from a model response, tolerating code fences. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  return JSON.parse(candidate.slice(start));
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "image"; source: { type: "url"; url: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/**
 * Call a model expecting strict JSON validated by a Zod schema.
 * On parse/validation failure, retries once with the error appended.
 * Logs token usage per call to the `usage` table.
 */
export async function askJson<S extends z.ZodType>(opts: {
  feature: string;
  model: string;
  system: string;
  content: string | ContentBlock[];
  schema: S;
  maxTokens?: number;
  /**
   * Sonnet 5 runs adaptive thinking at `high` effort when neither is set — a
   * silent change from Sonnet 4.6, where omitting `thinking` meant no thinking
   * at all. That default is right for planning and chat; for short structured
   * calls it's mostly latency. Set this to buy the wait back.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Whose spend this call is — stamped on the usage row for per-user totals. */
  userId?: string | null;
}): Promise<z.infer<S>> {
  const { feature, model, system, content, schema, maxTokens = 8192, effort, userId } = opts;

  const baseMessages: Anthropic.MessageParam[] = [
    { role: "user", content: content as Anthropic.MessageParam["content"] },
  ];

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: Anthropic.MessageParam[] = [...baseMessages];
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: `Your previous response was not valid JSON matching the required schema. Error: ${lastError}. Respond again with ONLY the corrected JSON object — no prose, no code fences.`,
      });
    }

    const response = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(effort ? { output_config: { effort } } : {}),
    });
    await logUsage(feature, model, response.usage, userId);

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    try {
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      lastError = JSON.stringify(parsed.error.issues.slice(0, 5));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Model returned invalid JSON for ${feature}: ${lastError}`);
}
