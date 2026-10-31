import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthPage as isAuthPagePath, isPublicPage as isPublicPagePath, isPublicAsset } from "@/lib/auth/routes";

const TEACHER_ROUTES = ["/teacher"];
const STUDENT_ROUTES = ["/dashboard", "/lesson", "/my-classes", "/achievements", "/map"];

export async function middleware(request: NextRequest) {
  // Manifest e iconos de la PWA (y Tonito): publicos, sin tocar Supabase.
  if (isPublicAsset(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];
  const finish = (res: NextResponse): NextResponse => {
    pendingCookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
  };

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          // El tipo de setAll es void: no puede devolver una respuesta. Las cookies que Supabase pide fijar (renovacion de la sesion) se guardan
          // y se aplican a la respuesta que se devuelva al final (ver `finish`).
          setAll(cookiesToSet) {
            cookiesToSet.forEach((c) => pendingCookies.push(c));
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
    const isAuthPage = isAuthPagePath(pathname);
    const isPublicPage = isPublicPagePath(pathname);

    if (!user && !isAuthPage && !isPublicPage) {
      return finish(NextResponse.redirect(new URL("/login", request.url)));
    }

    if (!user) {
      return finish(NextResponse.next());
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
      return finish(NextResponse.redirect(new URL(redirectUrl, request.url)));
    }

    if (role !== "teacher" && TEACHER_ROUTES.some((r) => pathname.startsWith(r))) {
      return finish(NextResponse.redirect(new URL("/dashboard", request.url)));
    }

    if (role === "teacher" && STUDENT_ROUTES.some((r) => pathname.startsWith(r))) {
      return finish(NextResponse.redirect(new URL("/teacher/dashboard", request.url)));
    }

    return finish(NextResponse.next());
  } catch (error) {
    const { pathname } = request.nextUrl;
    // Fail-closed selectivo: rutas protegidas redirigen a /login si hay error,
    // rutas públicas se dejan pasar. Esto evita que un error de Supabase
    // deje acceder a rutas que requerían autenticación (mitigación de 6.2.4
    // de la auditoría, segundo riesgo de escalabilidad identificado).
    const isProtectedTeacherRoute = TEACHER_ROUTES.some((r) => pathname.startsWith(r));
    const isProtectedStudentRoute = STUDENT_ROUTES.some((r) => pathname.startsWith(r));
    const isPublicPath =
      isAuthPagePath(pathname) ||
      isPublicPagePath(pathname) ||
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
