import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const protectedRoutes = [
  '/dashboard',
  '/inventory',
  '/shopping-list',
  '/supermarket',
  '/receipts',
  '/stock-checks',
  '/profiles'
]

const authRoutes = ['/login', '/register']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Preferir getUser() sobre getSession() en el borde: valida el JWT con el proyecto.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  const isAuthRoute = authRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // Solo la raíz exacta `/`; no usar pathname.startsWith('/') (coincide con todas las rutas).
  const isHomeRoute = request.nextUrl.pathname === '/'

  // Redirección para rutas protegidas sin sesión
  if (isProtectedRoute && !user) {
    const loginUrl = new URL('/login', request.nextUrl.origin)
    loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }

  // Redirección para rutas de autenticación con sesión (no existe /profiles; el onboarding es /profiles/new)
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl.origin))
  }

  // Redirección solo desde `/` cuando hay sesión
  if (isHomeRoute && user) {
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl.origin))
  }

  return response
}
