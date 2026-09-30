import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, userIdFromCookie } from "@/lib/auth";

// Gates the whole app behind the password cookie.
// /api/capture is excluded — it authenticates itself via x-api-key (iOS Shortcut).

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;

  if (await userIdFromCookie(token)) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/login") return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: [
    // everything except: capture endpoint, login endpoint, static/PWA assets
    "/((?!api/capture|api/login|_next/static|_next/image|favicon.ico|icon.svg|manifest|sw.js|icons/).*)",
  ],
};
