import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    // SameSite=None enables embedded sessions, so reject cross-origin writes.
    // Fetches made by our page inside GHL still have our own origin.
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin !== null && origin !== request.nextUrl.origin)) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
