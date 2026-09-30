import { createHash } from "crypto";
import { db } from "./db";
import { MODELS } from "./config";
import { askJson, ContentBlock } from "./anthropic";
import { ExtractionSchema, DuplicateSchema, Extraction } from "./schemas";
import {
  EXTRACT_FROM_URL_SYSTEM,
  EXTRACT_FROM_IMAGES_SYSTEM,
  EXTRACT_FROM_PDF_SYSTEM,
  EXTRACT_FROM_TEXT_SYSTEM,
} from "./prompts/extract";
import { DUPLICATE_CHECK_SYSTEM } from "./prompts/grocery";
import { embed, recipeEmbeddingText } from "./embeddings";

export type CapturePayload = {
  url?: string;
  images?: string[]; // base64
  pdf?: string; // base64
  text?: string;
  /**
   * Rendered page HTML captured client-side (the Safari share-sheet shortcut).
   * Only valid alongside `url`. Sites like Serious Eats 403 every server-side
   * fetch, but the user's own browser always has the page — so the shortcut
   * carries it here and we skip fetching entirely.
   */
  html?: string;
};

export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function fetchPage(url: string): Promise<{ html: string | null; status: number }> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
    if (!res.ok) return { html: null, status: res.status };
    return { html: await res.text(), status: res.status };
  } catch {
    return { html: null, status: 0 };
  }
}

/** Human-readable explanation for a page we couldn't load. */
export function pageFetchError(status: number): string {
  if (status === 403 || status === 401 || status === 429) {
    return `that site blocked the request (${status}). Some sites refuse anything that isn't a real browser — screenshot the recipe and share the images instead, which works everywhere.`;
  }
  if (status === 404) return "that page wasn't found (404) — check the link.";
  if (status >= 500) return `the site returned an error (${status}). Try again in a bit.`;
  return "couldn't load that page. Screenshot the recipe and share the images instead.";
}

// ---------------------------------------------------------------------------
// HTML → text (keep JSON-LD, drop nav/ads/scripts)
// ---------------------------------------------------------------------------
function htmlToText(html: string): string {
  const jsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .filter((s) => /"@type"\s*:\s*"?\[?"?Recipe/i.test(s) || s.includes("Recipe"))
    .join("\n");

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|footer|header|aside|form|iframe|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

  // When the structured data is demonstrably complete (it names both the
  // ingredients and the instructions), the page text is redundant — sending
  // 60K chars of it alongside was paying twice for the same recipe. A short
  // slice stays as backup for headnotes and the model's sanity checks; the
  // full 60K remains the fallback whenever JSON-LD is partial or absent.
  const jsonLdIsComplete =
    jsonLd.includes("recipeIngredient") && jsonLd.includes("recipeInstructions");
  const body = stripped.slice(0, jsonLdIsComplete ? 12_000 : 60_000);
  return jsonLd ? `JSON-LD structured data found on the page:\n${jsonLd.slice(0, 30_000)}\n\nPage text:\n${body}` : body;
}

function urlHash(url: string): string {
  return createHash("sha256").update(url.trim().replace(/[?#].*$/, "")).digest("hex");
}

/** Cache key for image/PDF captures: same pixels in, same recipe out. */
function contentHash(parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Hero image: find it in the raw HTML (og:image et al), then download it.
// Done deterministically rather than via the model — these tags are stripped
// by htmlToText before the model ever sees the page, and a regex is exact.
// ---------------------------------------------------------------------------
function absolutize(candidate: string, pageUrl: string): string | null {
  try {
    return new URL(candidate.trim().replace(/&amp;/g, "&"), pageUrl).toString();
  } catch {
    return null;
  }
}

function heroFromJsonLd(html: string, pageUrl: string): string | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    try {
      const parsed = JSON.parse(raw.trim());
      // image can be a string, an array, an ImageObject, or nested in @graph
      const stack: unknown[] = [parsed];
      while (stack.length) {
        const node = stack.pop();
        if (Array.isArray(node)) {
          stack.push(...node);
        } else if (node && typeof node === "object") {
          const obj = node as Record<string, unknown>;
          const image = obj.image;
          if (typeof image === "string") return absolutize(image, pageUrl);
          if (Array.isArray(image) && typeof image[0] === "string") {
            return absolutize(image[0] as string, pageUrl);
          }
          if (image && typeof image === "object") {
            const url = (image as Record<string, unknown>).url;
            if (typeof url === "string") return absolutize(url, pageUrl);
            if (Array.isArray(image) === false) stack.push(image);
          }
          if (obj["@graph"]) stack.push(obj["@graph"]);
        }
      }
    } catch {
      // malformed JSON-LD — try the next block
    }
  }
  return null;
}

export function findHeroImageUrl(html: string, pageUrl: string): string | null {
  const metaPatterns = [
    /<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
    /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const url = absolutize(match[1], pageUrl);
      if (url) return url;
    }
  }
  return heroFromJsonLd(html, pageUrl);
}

const MAX_IMAGE_BYTES = 10_000_000;
/** Hero images render ~180px wide in the grid; 1200px covers any screen. */
const HERO_MAX_WIDTH = 1200;

/**
 * Shrink a hero to what the UI can actually show. Any failure (odd format,
 * sharp missing a codec) returns the original untouched — a big image is
 * strictly better than no image.
 */
export async function optimizeHero(
  bytes: Buffer,
  contentType: string
): Promise<{ bytes: Buffer; contentType: string; ext: string }> {
  const original = {
    bytes,
    contentType,
    ext: (contentType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg",
  };
  // Animated formats: resizing would strip frames; keep as-is.
  if (contentType === "image/gif") return original;
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes)
      .rotate() // bake EXIF orientation in, since metadata may not survive
      .resize({ width: HERO_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    // A pathological source can re-encode larger; keep whichever is smaller.
    if (out.length >= bytes.length) return original;
    return { bytes: out, contentType: "image/webp", ext: "webp" };
  } catch {
    return original;
  }
}

/**
 * A tiny square companion to the hero, for the 44px avatars in pickers and
 * draft rows — a few KB instead of a few hundred. Timestamped name so a
 * replaced image can't be served from the browser's cache of the old URL.
 * Returns null on any failure; callers fall back to the full image.
 */
export async function storeThumbImage(recipeId: string, source: Buffer): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(source)
      .rotate()
      .resize(320, 320, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer();
    const path = `${recipeId}/thumb-${Date.now()}.webp`;
    const { error } = await db()
      .storage.from("captures")
      .upload(path, out, { contentType: "image/webp", upsert: true });
    if (error) return null;
    return publicUrl(path);
  } catch (err) {
    // Function logs are the only witness when this fails in production.
    console.error("storeThumbImage failed:", err);
    return null;
  }
}

/**
 * Download a hero image into Supabase Storage so it survives the source site
 * changing, reorganizing, or blocking hotlinks. Returns the stored public URL
 * plus its small thumb, or null if it couldn't be fetched (caller falls back
 * to the remote URL, with no thumb).
 */
export async function storeHeroImage(
  recipeId: string,
  imageUrl: string,
  referer?: string
): Promise<{ url: string; thumb: string | null } | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: { ...BROWSER_HEADERS, ...(referer ? { Referer: referer } : {}) },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;

    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length || raw.length > MAX_IMAGE_BYTES) return null;

    const hero = await optimizeHero(raw, contentType);
    const path = `${recipeId}/hero.${hero.ext}`;
    const { error } = await db()
      .storage.from("captures")
      .upload(path, hero.bytes, { contentType: hero.contentType, upsert: true });
    if (error) return null;

    return { url: publicUrl(path), thumb: await storeThumbImage(recipeId, hero.bytes) };
  } catch {
    return null;
  }
}

function imageMediaType(b64: string): string {
  if (b64.startsWith("/9j")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

// ---------------------------------------------------------------------------
// Store capture images/PDF in Supabase Storage; returns public URLs + paths
// ---------------------------------------------------------------------------
export async function storeCaptureFiles(
  recipeId: string,
  payload: CapturePayload
): Promise<{ imagePaths: string[]; pdfPath: string | null }> {
  const supabase = db();
  const imagePaths: string[] = [];
  let pdfPath: string | null = null;

  if (payload.images) {
    for (let i = 0; i < payload.images.length; i++) {
      const b64 = payload.images[i];
      const mediaType = imageMediaType(b64);
      const ext = mediaType.split("/")[1];
      const path = `${recipeId}/${i}.${ext}`;
      await supabase.storage
        .from("captures")
        .upload(path, Buffer.from(b64, "base64"), { contentType: mediaType, upsert: true });
      imagePaths.push(path);
    }
  }
  if (payload.pdf) {
    pdfPath = `${recipeId}/capture.pdf`;
    await supabase.storage
      .from("captures")
      .upload(pdfPath, Buffer.from(payload.pdf, "base64"), { contentType: "application/pdf", upsert: true });
  }
  return { imagePaths, pdfPath };
}

function publicUrl(path: string): string {
  return db().storage.from("captures").getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------
// The extraction pipeline. Runs after the capture response has been sent.
// ---------------------------------------------------------------------------
export async function runExtraction(recipeId: string, payload: CapturePayload, userId: string): Promise<void> {
  const supabase = db();
  try {
    await supabase.from("recipes").update({ capture_status: "processing" }).eq("id", recipeId);

    let extraction: Extraction;
    let heroImage: string | null = null;
    let thumbImage: string | null = null;

    if (payload.url) {
      // Cache by URL hash — re-saving the same link shouldn't re-extract.
      const hash = urlHash(payload.url);
      const { data: cached } = await supabase
        .from("extraction_cache")
        .select("extracted")
        .eq("url_hash", hash)
        .maybeSingle();

      let html: string | null = payload.html ?? null;
      if (cached) {
        extraction = ExtractionSchema.parse(cached.extracted);
      } else {
        if (!html) {
          const page = await fetchPage(payload.url);
          // Never hand the model an empty page — it would invent a recipe.
          if (!page.html) throw new Error(pageFetchError(page.status));
          html = page.html;
        }
        extraction = await askJson({
          feature: "extract_url",
          userId,
          model: MODELS.fast,
          system: EXTRACT_FROM_URL_SYSTEM,
          content: `Source URL: ${payload.url}\n\n${htmlToText(html)}`,
          schema: ExtractionSchema,
        });
      }

      // The hero image lives in <meta og:image>, which htmlToText strips before
      // the model sees it — so pull it from the raw HTML ourselves. Cache
      // entries written before this existed carry no image, so re-fetch the
      // page for those (a plain fetch, no tokens spent). A failure here is not
      // fatal: a recipe without a photo is still a recipe.
      if (!extraction.image_url) {
        html ??= (await fetchPage(payload.url)).html;
        if (html) extraction.image_url = findHeroImageUrl(html, payload.url);
      }

      await supabase.from("extraction_cache").upsert({ url_hash: hash, extracted: extraction });

      const stored = extraction.image_url
        ? await storeHeroImage(recipeId, extraction.image_url, payload.url)
        : null;
      heroImage = stored?.url ?? extraction.image_url ?? null;
      thumbImage = stored?.thumb ?? null;
    } else if (payload.images?.length) {
      const { imagePaths } = await storeCaptureFiles(recipeId, payload);
      // Vision calls are the priciest extractions and retries resend the same
      // pixels, so cache by content hash — same table as URLs, prefixed key.
      const hash = "img:" + contentHash(payload.images);
      const { data: cached } = await supabase
        .from("extraction_cache")
        .select("extracted")
        .eq("url_hash", hash)
        .maybeSingle();
      if (cached) {
        extraction = ExtractionSchema.parse(cached.extracted);
      } else {
        // All images in a single message, in order — never split into multiple
        // requests (that produces two half-recipes with no way to merge them).
        const content: ContentBlock[] = payload.images.map((b64) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: imageMediaType(b64), data: b64 },
        }));
        content.push({ type: "text", text: "Extract the recipe from these screenshots." });
        extraction = await askJson({
          feature: "extract_images",
          userId,
          model: MODELS.fast,
          system: EXTRACT_FROM_IMAGES_SYSTEM,
          content,
          schema: ExtractionSchema,
        });
        await supabase.from("extraction_cache").upsert({ url_hash: hash, extracted: extraction });
      }
      heroImage = imagePaths.length ? publicUrl(imagePaths[0]) : null;
      // The hero here is the person's own first photo; thumb it directly.
      thumbImage = payload.images.length
        ? await storeThumbImage(recipeId, Buffer.from(payload.images[0], "base64"))
        : null;
      // keep storage paths in raw_capture instead of megabytes of base64
      await supabase
        .from("recipes")
        .update({ raw_capture: { type: "images", storage_paths: imagePaths } })
        .eq("id", recipeId);
    } else if (payload.pdf) {
      const { pdfPath } = await storeCaptureFiles(recipeId, payload);
      const hash = "pdf:" + contentHash([payload.pdf]);
      const { data: cached } = await supabase
        .from("extraction_cache")
        .select("extracted")
        .eq("url_hash", hash)
        .maybeSingle();
      if (cached) {
        extraction = ExtractionSchema.parse(cached.extracted);
      } else {
        extraction = await askJson({
          feature: "extract_pdf",
        userId,
          model: MODELS.fast,
          system: EXTRACT_FROM_PDF_SYSTEM,
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: payload.pdf } },
            { type: "text", text: "Extract the recipe from this PDF." },
          ],
          schema: ExtractionSchema,
        });
        await supabase.from("extraction_cache").upsert({ url_hash: hash, extracted: extraction });
      }
      const stored = extraction.image_url
        ? await storeHeroImage(recipeId, extraction.image_url)
        : null;
      heroImage = stored?.url ?? extraction.image_url ?? null;
      thumbImage = stored?.thumb ?? null;
      await supabase
        .from("recipes")
        .update({ raw_capture: { type: "pdf", storage_path: pdfPath } })
        .eq("id", recipeId);
    } else if (payload.text) {
      extraction = await askJson({
        feature: "extract_text",
        userId,
        model: MODELS.fast,
        system: EXTRACT_FROM_TEXT_SYSTEM,
        content: payload.text.slice(0, 60_000),
        schema: ExtractionSchema,
      });
      const stored = extraction.image_url
        ? await storeHeroImage(recipeId, extraction.image_url)
        : null;
      heroImage = stored?.url ?? extraction.image_url ?? null;
      thumbImage = stored?.thumb ?? null;
    } else {
      throw new Error("Empty capture payload");
    }

    // If the model reported gaps, the capture is still ready — the UI shows a
    // quiet "this might be incomplete" flag from capture_gaps.
    await supabase
      .from("recipes")
      .update({
        title: extraction.title,
        description: extraction.description,
        ingredients: extraction.ingredients,
        steps: extraction.steps,
        servings: extraction.servings,
        time_total_min: extraction.time_total_min,
        time_active_min: extraction.time_active_min,
        tags: extraction.tags,
        cuisine: extraction.cuisine,
        course: extraction.course,
        season: extraction.season,
        occasion: extraction.occasion,
        main_ingredients: extraction.main_ingredients,
        image_url: heroImage,
        image_thumb_url: thumbImage,
        source_name: extraction.source_name,
        capture_status: "ready",
        capture_error: null,
        capture_gaps: extraction.gaps,
      })
      .eq("id", recipeId);

    await supabase.from("pending_captures").delete().eq("recipe_id", recipeId);

    // Fire-and-forget enrichments; failures here never fail the capture.
    await Promise.allSettled([checkDuplicate(recipeId, extraction, userId), updateEmbedding(recipeId)]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    await supabase
      .from("recipes")
      .update({
        capture_status: "failed",
        capture_error: `Couldn't extract this recipe: ${message}`,
      })
      .eq("id", recipeId);
    const { data: pending } = await supabase
      .from("pending_captures")
      .select("id, attempts")
      .eq("recipe_id", recipeId)
      .maybeSingle();
    if (pending) {
      await supabase
        .from("pending_captures")
        .update({ attempts: pending.attempts + 1, last_error: message })
        .eq("id", pending.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection — save anyway, flag possible_duplicate_of, never block
// ---------------------------------------------------------------------------
async function checkDuplicate(recipeId: string, extraction: Extraction, userId: string): Promise<void> {
  const supabase = db();
  const { data: existing } = await supabase
    .from("recipes")
    .select("id, title, main_ingredients")
    .eq("user_id", userId)
    .neq("id", recipeId)
    .eq("capture_status", "ready")
    .order("created_at", { ascending: false })
    .limit(300);
  if (!existing?.length) return;

  const result = await askJson({
    feature: "duplicate_check",
    userId,
    model: MODELS.fast,
    system: DUPLICATE_CHECK_SYSTEM,
    content: JSON.stringify({
      new_recipe: { title: extraction.title, main_ingredients: extraction.main_ingredients },
      existing,
    }),
    schema: DuplicateSchema,
    maxTokens: 256,
  });

  if (result.duplicate_id && existing.some((r) => r.id === result.duplicate_id)) {
    await supabase
      .from("recipes")
      .update({ possible_duplicate_of: result.duplicate_id })
      .eq("id", recipeId);
  }
}

// ---------------------------------------------------------------------------
// Embedding for semantic search (no-op without VOYAGE_API_KEY)
// ---------------------------------------------------------------------------
export async function updateEmbedding(recipeId: string): Promise<void> {
  const supabase = db();
  const { data: recipe } = await supabase
    .from("recipes")
    .select("title, description, main_ingredients, notes, tags, cuisine")
    .eq("id", recipeId)
    .maybeSingle();
  if (!recipe) return;
  const vectorData = await embed(recipeEmbeddingText(recipe), "document");
  if (vectorData) {
    await supabase.from("recipes").update({ embedding: vectorData }).eq("id", recipeId);
  }
}
