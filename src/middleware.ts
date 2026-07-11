import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            const response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
            return response;
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    const isAuthPage = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup";
    const isPublicPage = request.nextUrl.pathname === "/offline";

    if (!user && !isAuthPage && !isPublicPage) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (user && isAuthPage) {
      const role = (user.user_metadata?.role as string) || "student";
      const redirectUrl = role === "teacher" ? "/teacher/dashboard" : "/dashboard";
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    return NextResponse.next();
  } catch (error) {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js).*)"],
};
