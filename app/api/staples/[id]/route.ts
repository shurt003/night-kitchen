import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GROCERY_SECTIONS } from "@/lib/config";
import { currentUserId } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.typical_cadence_days === null || typeof body.typical_cadence_days === "number") {
    patch.typical_cadence_days = body.typical_cadence_days;
  }
  if ((GROCERY_SECTIONS as readonly string[]).includes(body.section)) patch.section = body.section;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await db()
    .from("staples")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staple: data });
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { error } = await db().from("staples").delete().eq("id", id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
