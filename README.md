# ATTILA V4

Avatar management and automation platform for social media networks.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Styling**: Tailwind CSS v4, shadcn/ui (base-nova)
- **Database**: Supabase (PostgreSQL + Auth + Realtime + RLS)
- **Language**: TypeScript
- **Deployment**: Render (standalone output)

## Getting Started

```bash
npm install
cp .env.example .env.local
# Fill in your Supabase credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
src/
├── app/
│   ├── (admin)/          # Admin dashboard (route group)
│   ├── (client)/         # Client dashboard (route group)
│   ├── actions/          # Server actions (auth)
│   └── page.tsx          # Home page (login)
├── components/
│   ├── auth/             # Authentication components
│   ├── layout/           # Shared layout (header, footer)
│   └── ui/               # shadcn/ui components
├── hooks/                # Custom React hooks
├── lib/
│   ├── auth/             # Auth helpers (session, permissions)
│   └── supabase/         # Supabase clients (browser, server, proxy)
└── types/                # TypeScript type definitions

proxy.ts                  # Next.js Proxy — session refresh via getClaims()
```

## Supabase Integration

Follows the [official Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/nextjs):

- **Publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — replaces legacy anon key
- **`proxy.ts`** — Next.js 16 Proxy (replaces middleware.ts), refreshes auth tokens via `getClaims()`
- **`getClaims()`** — validates JWT signature server-side, used instead of `getUser()`/`getSession()`
- **RLS policies** — no recursive queries, uses `auth.uid()` for own-row access

## Roles

| Role       | Access                                          |
|------------|------------------------------------------------|
| `admin`    | Admin dashboard, can impersonate any client     |
| `manager`  | Client dashboard, full access                   |
| `operator` | Client dashboard, restricted access (future)    |

## Environment Variables

| Variable                              | Description                |
|---------------------------------------|----------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`            | Supabase project URL       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`| Supabase publishable key   |
