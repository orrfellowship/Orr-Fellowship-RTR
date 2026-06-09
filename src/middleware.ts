import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Prefetch requests (Link hover / viewport) don't need the auth gate — the
  // real navigation runs it. Skipping keeps token work off the prefetch path,
  // which fires for every link the user merely scrolls past.
  if (
    request.headers.get("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch"
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // getSession() reads (and refreshes) the token from the cookie locally — no
  // network round-trip to the Auth server on every navigation, unlike getUser().
  // This gate only decides "logged in vs. login redirect"; anything sensitive is
  // still re-verified server-side by getCurrentProfile() (getUser) + RLS.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  // unauthenticated and not on a public route -> send to login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // protect everything except static assets and the API sync route's own auth
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
