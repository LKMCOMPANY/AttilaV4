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

## Quality gates

```bash
npm run check    # tsc --noEmit + eslint — must exit 0
npm run build    # the real integration check
```

Enforced by `.github/workflows/ci.yml` on every push and pull request.
`npm run lint` must report **zero errors**; the remaining warnings are
pre-existing and tracked, not a licence to add more.

## Operational scripts

**Start here — read the truth before changing anything.** None of these ever
exceed the VMOS ceiling of 10 running containers per box, and none touch a
device with a campaign job due.

```bash
# Fleet drift: versions, hardware model, disk headroom, DB↔live, provisioning
node infra/boxes/scripts/check-drift.mjs

# What is installed, read OFFLINE from each stopped container's data.img.
# 451 devices inventoried without booting one. Fills adbkeyboard/tiktok/twitter.
node scripts/audit-device-packages.mjs

# Does it actually boot? `state: running` does not mean Android came up.
node scripts/audit-device-health.mjs --box box-1.attila.army
node scripts/audit-device-health.mjs --box box-1.attila.army --recheck --concurrency 1

# Ghost rows: DB devices whose container no longer exists on the box
node scripts/reconcile-devices.mjs --dry-run

# Proxy routing + exit-IP geo coherence
node scripts/audit-proxies.mjs --running-only --geo
```

```bash
# Install ADBKeyboard — prefer --missing-only, it uses the offline audit so
# only the devices that actually lack the APK are booted
node scripts/install-adbkeyboard.mjs --missing-only --box box-3.attila.army

# Tune the on-device scrcpy (short GOP, capped bitrate/fps, quieter log)
node scripts/tune-scrcpy.mjs --box box-5.attila.army
node scripts/tune-scrcpy.mjs --box box-5.attila.army --revert

# Manual single-device automation tests
npx tsx scripts/x-reply.ts      --box <host> --device <db_id> --tweet-url <url> --text "<reply>"
npx tsx scripts/tiktok-reply.ts --box <host> --device <db_id> --video-url <url> --text "<reply>"
```

VMOS host limit: **10 containers running simultaneously max**. Respect this
with `--concurrency` on the install script.

See `ADB-REFERENCE.md` (section 2 bis) for the full ADBKeyboard provisioning
spec including the mandatory `pm enable` step, and
[`infra/boxes/MAINTENANCE.md`](infra/boxes/MAINTENANCE.md) for the box runbook
— disk reclamation, the `starting` deadlock, vendor upgrades, stream diagnosis.

## For agents

If you're an AI assistant being asked to modify this codebase, **read
`AGENTS.md` first**. It points you to the right domain doc, lists the hard
rules from the 18 April 2026 automation refactor, and tells you which
patterns will get you bitten if you copy from older code.
