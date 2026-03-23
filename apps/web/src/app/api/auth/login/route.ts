import { type NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env['API_URL'] ?? 'http://localhost:3001'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as unknown

    const apiRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await apiRes.json() as { accessToken?: string; refreshToken?: string; error?: string }

    if (!apiRes.ok) {
      return NextResponse.json({ error: data.error ?? 'Login failed' }, { status: apiRes.status })
    }

    const response = NextResponse.json({ success: true })

    // Set httpOnly cookie with the access token
    if (data.accessToken) {
      response.cookies.set('accessToken', data.accessToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60, // 15 minutes
      })
    }

    return response
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
