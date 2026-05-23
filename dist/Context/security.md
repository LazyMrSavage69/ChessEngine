# Security Guide — Claude Prompt File

Paste this at the start of a conversation when you need security help for your app.

---

## Project Context

> *(Fill in before using)*

- **Stack:** ___
- **Deployment:** Vercel
- **Database:** ___
- **Auth method:** ___
- **Redis / session store:** ___
- **Current security concern:** ___

---

## Core Rules Claude Must Follow

1. **Never suggest in-memory stores** — Vercel is serverless and stateless. No Maps, globals, or module-level variables.
2. **Always use a persistent store** — DB or Redis (Upstash preferred) for anything that must survive between requests.
3. **Prefer Edge Middleware** for auth checks — runs before every route, cheapest point to block a request.
4. **Never store plain-text passwords** — always bcrypt or argon2.
5. **Never expose secrets in client code** — env vars must be server-only unless prefixed `NEXT_PUBLIC_` intentionally.
6. **Short-lived tokens** — JWTs and session tokens should have expiry. Refresh tokens separately.
7. **Validate on the server** — never trust client-side validation alone.

---

## Session Management

### Single Active Session (One Login at a Time)

Store the current token in DB or Redis. On every request, compare against stored value. Mismatch = kick out.

```ts
// On login — overwrite existing session
await redis.set(`session:${userId}`, newToken, { ex: 86400 }); // 24h TTL

// Middleware check
const stored = await redis.get(`session:${userId}`);
if (stored !== requestToken) {
  return NextResponse.redirect(new URL('/login', req.url));
}
```

### Session Expiry & Cleanup

- Use Redis TTL to auto-expire sessions — handles tab-close and abandoned sessions
- On explicit logout: delete the key immediately
- On password change: delete all active sessions for that user

```ts
// Logout
await redis.del(`session:${userId}`);

// Password change — invalidate all sessions
await redis.del(`session:${userId}`); // extend with pattern if tracking multiple devices
```

---

## Authentication

### Password Hashing

```ts
import bcrypt from 'bcryptjs';

// Hash on register
const hash = await bcrypt.hash(password, 12);

// Verify on login
const valid = await bcrypt.compare(password, user.passwordHash);
```

### JWT Best Practices

- Access token: short TTL (15min)
- Refresh token: longer TTL (7d), stored in httpOnly cookie
- Never store JWTs in localStorage — use httpOnly cookies

```ts
// Set as httpOnly cookie
res.setHeader('Set-Cookie', serialize('token', jwt, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 60 * 15, // 15 min
  path: '/',
}));
```

---

## Vercel Middleware Pattern

Use `middleware.ts` at the project root to protect all routes:

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('session_token')?.value;
  const userId = req.cookies.get('user_id')?.value;

  if (!token || !userId) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const stored = await redis.get(`session:${userId}`);
  if (stored !== token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/protected/:path*'],
};
```

---

## Environment Variables

```bash
# .env.local — never commit this
DATABASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
JWT_SECRET=
NEXTAUTH_SECRET=
```

Rules:
- All secrets = server-only (no `NEXT_PUBLIC_` prefix)
- Rotate secrets if ever exposed
- Use Vercel's environment variable dashboard, not `.env` files in production

---

## Input Validation

Always validate and sanitize on the server. Use `zod` for schema validation:

```ts
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const parsed = loginSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: parsed.error.flatten() });
}
```

---

## Rate Limiting

Use Upstash's rate limiting library on sensitive endpoints (login, register, password reset):

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 m'), // 5 requests per minute
});

const { success } = await ratelimit.limit(req.ip ?? 'anonymous');
if (!success) {
  return res.status(429).json({ error: 'Too many requests' });
}
```

---

## Common Vulnerabilities — Claude Should Always Check

| Vulnerability | What to look for |
|---|---|
| XSS | Unsanitized user input rendered as HTML |
| CSRF | Mutations without CSRF token or sameSite cookie |
| SQL Injection | Raw string queries with user input |
| Broken auth | Missing middleware on protected routes |
| Insecure cookies | Missing httpOnly, secure, sameSite flags |
| Exposed secrets | API keys in client bundle or public repo |
| Mass assignment | Accepting all body fields without filtering |
| Open redirect | Redirect URLs taken directly from query params |

---

## What to Ask Claude

- "Review this auth flow for security issues"
- "Is this session management approach safe on Vercel?"
- "Add rate limiting to this login endpoint"
- "Am I handling cookies securely?"
- "What's the safest way to reset passwords in my stack?"
- "Check this middleware for any gaps in route protection"

---

## Security Log

> Track issues found and fixed. Add entries as you go.

Format:
```
Date: YYYY-MM-DD
Issue: [description]
Severity: Low / Medium / High / Critical
Fixed: Yes / No / In Progress
Fix: [what was done]
```

Date: 2026-05-23
Issue: Access codes were treated as one-time use with no expiration enforcement.
Severity: Medium
Fixed: Yes
Fix: Updated access-code validation to allow reuse for the same email within 30 days, added expiry checks, and surfaced clearer admin/user messaging.