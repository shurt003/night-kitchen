import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db()
    .from("quick_meals")
    .select("*")
    .eq("user_id", userId)
    .order("times_used", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quick_meals: data ?? [] });
}

/**
 * POST /api/quick-meals — promote a typed meal into something reusable.
 * Never called automatically: quick meals exist only when explicitly saved (§3).
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data, error } = await db()
    .from("quick_meals")
    .insert({ user_id: userId, name, ingredients: body.ingredients ?? [] })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quick_meal: data });
}
