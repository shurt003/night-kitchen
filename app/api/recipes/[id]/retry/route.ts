import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { runExtraction, CapturePayload } from "@/lib/extract";
import { currentUserId } from "@/lib/auth";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** POST /api/recipes/[id]/retry — re-run a failed extraction from raw_capture. */
export async function POST(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = db();
  const { data: recipe } = await supabase
    .from("recipes")
    .select("id, raw_capture")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!recipe?.raw_capture) {
    return NextResponse.json({ error: "Nothing to retry" }, { status: 400 });
  }

  const raw = recipe.raw_capture as {
    type: string;
    url?: string;
    text?: string;
    storage_paths?: string[];
    storage_path?: string;
  };

  let payload: CapturePayload | null = null;
  if (raw.type === "url" && raw.url) {
    // A share-sheet capture stashed the rendered HTML in pending_captures —
    // reuse it, since the server may not be able to fetch this site at all.
    const { data: pending } = await supabase
      .from("pending_captures")
      .select("payload")
      .eq("recipe_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    const html = (pending?.[0]?.payload as { html?: string } | undefined)?.html;
    payload = html ? { url: raw.url, html } : { url: raw.url };
  }
  else if (raw.type === "text" && raw.text) payload = { text: raw.text };
  else if (raw.type === "images" && raw.storage_paths?.length) {
    const images: string[] = [];
    for (const path of raw.storage_paths) {
      const { data: blob } = await supabase.storage.from("captures").download(path);
      if (blob) images.push(Buffer.from(await blob.arrayBuffer()).toString("base64"));
    }
    if (images.length) payload = { images };
  } else if (raw.type === "pdf" && raw.storage_path) {
    const { data: blob } = await supabase.storage.from("captures").download(raw.storage_path);
    if (blob) payload = { pdf: Buffer.from(await blob.arrayBuffer()).toString("base64") };
  }

  if (!payload) {
    return NextResponse.json({ error: "Original capture data unavailable" }, { status: 400 });
  }

  await supabase
    .from("recipes")
    .update({ capture_status: "pending", capture_error: null })
    .eq("id", id)
    .eq("user_id", userId);

  const finalPayload = payload;
  after(async () => runExtraction(id, finalPayload, userId));
  return NextResponse.json({ id, status: "pending" });
}
