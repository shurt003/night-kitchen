import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AUTH_COOKIE, signUserCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!password) return NextResponse.json({ error: "Wrong password" }, { status: 401 });

  // A handful of users, so a direct password match is fine. limit(1) rather
  // than maybeSingle so a (mistaken) shared password can't 500 the login.
  const { data } = await db().from("users").select("id").eq("password", password).limit(1);
  const user = data?.[0];
  if (!user) return NextResponse.json({ error: "Wrong password" }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await signUserCookie(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
