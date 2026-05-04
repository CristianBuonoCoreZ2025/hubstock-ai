import { NextRequest, NextResponse } from 'next/server'
import { proxy } from './src/proxy'

export async function middleware(request: NextRequest) {
  return await proxy(request)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.rsc$).*)',
  ],
}
