import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page. Refreshes the Supabase session cookie and
 * sends anyone who is not logged in to /login.
 * (Next.js 16 renamed middleware.ts to proxy.ts.)
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet, cacheHeaders) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(cacheHeaders ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (!data.user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (data.user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip static files, images and the make.com webhook (it authenticates with its own secret).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ingest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
