import { NextResponse, type NextRequest } from "next/server";

function getOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    // SameSite=None enables embedded sessions, so reject cross-origin writes.
    // Fetches made by our page inside GHL still have our own origin.
    const origin = request.headers.get("origin");
    // Next.js may see an internal URL behind a reverse proxy. APP_URL is the
    // configured public portal URL; Host also supports preserved public hosts.
    const allowedOrigins = new Set([
      request.nextUrl.origin,
      getOrigin(process.env.APP_URL),
      getOrigin(`${request.nextUrl.protocol}//${request.headers.get("host") || request.nextUrl.host}`),
    ]);
    if (request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin !== null && !allowedOrigins.has(origin))) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
