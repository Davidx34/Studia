import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const TEACHER_ROUTES = ["/teacher"];
const STUDENT_ROUTES = ["/dashboard", "/lesson", "/my-classes", "/achievements", "/map"];

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

    const { pathname } = request.nextUrl;

    // El panel de desarrollador (/dev/* y sus API routes /api/dev-auth,
    // /api/dev/*) tiene su propia sesion (cookie firmada, ver
    // src/lib/devAuth.ts) completamente separada del auth de Supabase — no
    // debe pasar por este gate ni por la logica de rol de abajo.
    if (pathname.startsWith("/dev") || pathname.startsWith("/api/dev")) {
      return NextResponse.next();
    }

    const { data: { user } } = await supabase.auth.getUser();
    const isAuthPage = pathname === "/login" || pathname === "/signup";
    const isPublicPage = pathname === "/offline";

    if (!user && !isAuthPage && !isPublicPage) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (!user) {
      return NextResponse.next();
    }

    // El rol vive en profiles, no en auth user_metadata (el signup no lo setea ahi).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = profile?.role || "student";

    if (isAuthPage) {
      const redirectUrl = role === "teacher" ? "/teacher/dashboard" : "/dashboard";
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    if (role !== "teacher" && TEACHER_ROUTES.some((r) => pathname.startsWith(r))) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (role === "teacher" && STUDENT_ROUTES.some((r) => pathname.startsWith(r))) {
      return NextResponse.redirect(new URL("/teacher/dashboard", request.url));
    }

    return NextResponse.next();
  } catch (error) {
    const { pathname } = request.nextUrl;
    // Fail-closed selectivo: rutas protegidas redirigen a /login si hay error,
    // rutas públicas se dejan pasar. Esto evita que un error de Supabase
    // deje acceder a rutas que requerían autenticación (mitigación de 6.2.4
    // de la auditoría, segundo riesgo de escalabilidad identificado).
    const isProtectedTeacherRoute = TEACHER_ROUTES.some((r) => pathname.startsWith(r));
    const isProtectedStudentRoute = STUDENT_ROUTES.some((r) => pathname.startsWith(r));
    const isPublicPath =
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/offline" ||
      pathname.startsWith("/dev") ||
      pathname.startsWith("/api/dev");

    if ((isProtectedTeacherRoute || isProtectedStudentRoute) && !isPublicPath) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js).*)"],
};
