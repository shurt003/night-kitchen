import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";
import { runExtraction, CapturePayload } from "@/lib/extract";

export const maxDuration = 300; // Vercel: give post-response extraction room to finish

/**
 * POST /api/capture
 * Auth: x-api-key header (iOS Shortcut) or the session cookie (web UI).
 * Accepts one of: { url } | { images: [base64] } | { pdf: base64 } | { text }.
 *
 * Returns within ~1 second with { id, status: "pending" }. Extraction happens
 * after the response via Next's `after()` — on Vercel this keeps the function
 * alive after the response is sent (no separate queue infra needed), which is
 * the most reliable zero-dependency option there. The recipe row is created
 * immediately so the UI can show the skeleton card while extraction runs.
 */
export async function POST(req: Request) {
  // Resolve the owner: the iOS Shortcut's x-api-key maps to a user's
  // capture_key; the web UI uses the session cookie.
  const apiKey = req.headers.get("x-api-key");
  let userId: string | null;
  if (apiKey) {
    const { data } = await db().from("users").select("id").eq("capture_key", apiKey).limit(1);
    userId = data?.[0]?.id ?? null;
  } else {
    userId = await currentUserId(req);
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CapturePayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kinds = [payload.url, payload.images, payload.pdf, payload.text].filter(Boolean);
  if (kinds.length !== 1) {
    return NextResponse.json(
      { error: "Provide exactly one of: url, images, pdf, text" },
      { status: 400 }
    );
  }
  // html rides along with url (page captured client-side, so we skip fetching).
  if (payload.html && !payload.url) {
    return NextResponse.json({ error: "html requires url" }, { status: 400 });
  }
  if (payload.html && payload.html.length > 3_000_000) {
    payload.html = payload.html.slice(0, 3_000_000);
  }
  if (payload.images && (!Array.isArray(payload.images) || payload.images.length === 0)) {
    return NextResponse.json({ error: "images must be a non-empty array" }, { status: 400 });
  }

  const sourceType = payload.url ? "url" : payload.images ? "images" : payload.pdf ? "pdf" : "manual";
  const supabase = db();

  const { data: recipe, error } = await supabase
    .from("recipes")
    .insert({
      user_id: userId,
      title: payload.url ? new URL(payload.url).hostname.replace(/^www\./, "") : "Captured recipe",
      source_type: sourceType,
      source_url: payload.url ?? null,
      capture_status: "pending",
      // Store lightweight raw payloads inline; image/pdf bytes are moved to
      // Storage during extraction and raw_capture is updated to the paths.
      raw_capture: payload.url
        ? { type: "url", url: payload.url }
        : payload.text
          ? { type: "text", text: payload.text }
          : { type: sourceType },
    })
    .select("id")
    .single();

  if (error || !recipe) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  // Retry queue row — a failed extraction can be retried without losing the share.
  await supabase.from("pending_captures").insert({
    recipe_id: recipe.id,
    // html is kept here (not in raw_capture) so a retry doesn't have to
    // re-fetch a page the server may not be able to reach.
    payload: payload.url
      ? { type: "url", url: payload.url, ...(payload.html ? { html: payload.html } : {}) }
      : payload.text
        ? { type: "text", text: payload.text }
        : { type: sourceType }, // bytes land in Storage during extraction
  });

  // Run extraction after the response has been sent.
  after(async () => {
    await runExtraction(recipe.id, payload, userId);
  });

  return NextResponse.json({ id: recipe.id, status: "pending" });
}
