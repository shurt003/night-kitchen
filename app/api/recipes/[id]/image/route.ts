import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  fetchPage,
  findHeroImageUrl,
  optimizeHero,
  pageFetchError,
  storeHeroImage,
  storeThumbImage,
} from "@/lib/extract";
import { currentUserId } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const MAX_UPLOAD_BYTES = 12_000_000;

/**
 * PUT /api/recipes/[id]/image — upload your own image (multipart, field "file").
 * For recipes with no photo, or when you'd rather use your own crop than
 * whatever the site used. Replaces any previous hero image.
 */
export async function PUT(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = db();

  const { data: owned } = await supabase
    .from("recipes").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const contentType = (file.type || "").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "That file isn't an image." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That image is too large (12MB max)." }, { status: 413 });
  }

  // Clear previous hero files so storage doesn't accumulate copies, and so the
  // new URL differs from the old one (browsers cache aggressively by URL).
  const { data: existing } = await supabase.storage.from("captures").list(id);
  const oldHeroes = (existing ?? [])
    .filter((f) => f.name.startsWith("hero") || f.name.startsWith("thumb"))
    .map((f) => `${id}/${f.name}`);
  if (oldHeroes.length) await supabase.storage.from("captures").remove(oldHeroes);

  // Phone screenshots are routinely 3-8MB for a card the grid shows at ~180px.
  const hero = await optimizeHero(bytes, contentType);
  const path = `${id}/hero-${Date.now()}.${hero.ext}`;
  const { error: uploadError } = await supabase.storage
    .from("captures")
    .upload(path, hero.bytes, { contentType: hero.contentType, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const publicUrl = supabase.storage.from("captures").getPublicUrl(path).data.publicUrl;
  const { data: updated, error } = await supabase
    .from("recipes")
    .update({ image_url: publicUrl, image_thumb_url: await storeThumbImage(id, hero.bytes) })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recipe: updated });
}

/**
 * POST /api/recipes/[id]/image
 * Re-fetch the source page, find its hero image, and store a copy.
 * For recipes captured before image handling existed, or whose image failed.
 */
export async function POST(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = db();

  const { data: recipe } = await supabase
    .from("recipes")
    .select("id, source_url")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!recipe) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!recipe.source_url) {
    return NextResponse.json({ error: "This recipe has no source link to pull an image from." }, { status: 400 });
  }

  const page = await fetchPage(recipe.source_url);
  if (!page.html) {
    return NextResponse.json({ error: pageFetchError(page.status) }, { status: 502 });
  }

  const found = findHeroImageUrl(page.html, recipe.source_url);
  if (!found) {
    return NextResponse.json({ error: "No image found on the original page." }, { status: 404 });
  }

  const stored = await storeHeroImage(id, found, recipe.source_url);
  const { data: updated, error } = await supabase
    .from("recipes")
    .update({ image_url: stored?.url ?? found, image_thumb_url: stored?.thumb ?? null })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recipe: updated });
}
