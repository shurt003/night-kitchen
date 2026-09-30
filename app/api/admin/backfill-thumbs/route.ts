import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storeThumbImage } from "@/lib/extract";
import { currentUserId } from "@/lib/auth";

// Resizing dozens of images in one pass can be slow; give it headroom.
export const maxDuration = 300;

const MAX_REMOTE_BYTES = 15_000_000;

/**
 * GET /api/admin/backfill-thumbs — one-shot: give every recipe that has a hero
 * but no thumb its small companion image. Visit it once, logged in, after the
 * image_thumb_url column exists; safe to re-run (it only touches rows where
 * the thumb is still null). Covers ALL users' recipes — any signed-in account
 * may trigger it, which is fine for a household of three; the work itself is
 * idempotent and touches nothing a user could lose.
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = db();

  const { data: rows, error } = await supabase
    .from("recipes")
    .select("id, title, image_url")
    .not("image_url", "is", null)
    .is("image_thumb_url", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  // Diagnostic-rich on purpose: a run that fails should say exactly why,
  // per recipe, so the fix doesn't need guesswork.
  const failed: { title: string; via: string; error: string }[] = [];

  for (const r of rows ?? []) {
    const title = r.title ?? r.id;
    let via = "none";
    try {
      const url = r.image_url as string;
      let bytes: Buffer | null = null;
      let fetchError = "";

      // Our own stored heroes come out of the bucket directly; anything else
      // (recipes whose hero never made it into storage) is fetched remotely.
      const bucketPath = url.includes("/captures/")
        ? decodeURIComponent(url.split("/captures/")[1].split("?")[0])
        : null;
      if (bucketPath) {
        via = `bucket:${bucketPath}`;
        const { data: blob, error: dlError } = await supabase.storage
          .from("captures")
          .download(bucketPath);
        if (blob) bytes = Buffer.from(await blob.arrayBuffer());
        else fetchError = dlError?.message ?? "empty download";
      } else {
        via = `remote:${url.slice(0, 60)}`;
        const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length && buf.length <= MAX_REMOTE_BYTES) bytes = buf;
          else fetchError = `size ${buf.length}`;
        } else fetchError = `http ${res.status}`;
      }
      if (!bytes) {
        failed.push({ title, via, error: fetchError || "no bytes" });
        continue;
      }

      const thumb = await storeThumbImage(r.id, bytes);
      if (!thumb) {
        failed.push({ title, via, error: "thumb resize/upload returned null" });
        continue;
      }
      await supabase.from("recipes").update({ image_thumb_url: thumb }).eq("id", r.id);
      updated++;
    } catch (err) {
      failed.push({ title, via, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    updated,
    failed,
    message:
      updated || failed.length
        ? `Thumbed ${updated} recipe${updated === 1 ? "" : "s"}${failed.length ? `; ${failed.length} couldn't be fetched` : ""}.`
        : "Nothing to do — every recipe with an image already has its thumb.",
  });
}
