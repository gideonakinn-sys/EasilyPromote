# AGENTS.md — EasilyPromote Codebase Guide

## Project Overview

Two-sided marketplace connecting brands with content creators. Brands fund campaigns around an **objective** — Views (pay per view), Sign-ups (referral codes, no views target), Content (pay per approved deliverable), or Hybrid (views + sign-ups). Results (views, conversions, clicks) are tracked and paid out through **Paystack-escrowed** funds. Marketing site + creator/brand dashboards live in one Next.js app.

## Repository Structure

```
Easily-promote/
  Backend/   Express.js API (CommonJS, port 5000)
  Fontend/   npm + turbo monorepo (the "Fontend" dir typo is intentional)
    apps/
      web/      @ep/web   — CANONICAL app (Next 15, port 3000)
      admin/    @ep/admin — port 3003
      brand/    @ep/brand  — superseded standalone app (not in the dev loop)
      creator/  @ep/creator — superseded standalone app (not in the dev loop)
    packages/
      ui/       @ep/ui — shared components, hooks, assets, utils
```

`apps/web` hosts every user surface: role routing at `/` (brand → `/dashboard/brand`, creator → `/dashboard/creator`, admin → `:3003`).

## Build / Dev / Lint / Typecheck Commands

### Frontend (from `Fontend/`)
```bash
npm run dev                       # turbo: web + admin
npm run dev --filter=@ep/web      # single app
npm run build                     # turbo build web
```
- **Lint**: `npm run lint` uses `next lint`, but there is **no ESLint config** in the repo — it prompts to create one and is unusable until configured. Don't depend on lint passing.
- **Typecheck is the ONLY gate**: never run `next build`/`npm run build` as a check. Use `npx tsc --noEmit` from `apps/web` (plus `apps/admin` when admin changes) and, when a quick runtime sanity check is needed, smoke-test the dev server (route returns 200).
- `incremental` + `tsBuildInfoFile` (`node_modules/.cache/tsconfig.tsbuildinfo`) are configured. For iteration use a warm watcher: `npx tsc --noEmit --incremental -w`; for a one-off check run `npx tsc --noEmit --incremental`.

### Backend (from `Backend/`)
```bash
npm run dev              # nodemon src/server.js (port 5000)
npm run start            # production
npm test                 # unit then e2e
npm run test:unit        # node --test test/unit/**
npm run test:e2e         # node --test --test-concurrency=1 test/e2e/**
```
**Run a single test:**
```bash
node --test test/unit/campaignBudget.test.js          # unit file
node --test --test-concurrency=1 test/e2e/views-campaign.test.js   # e2e file
node --test --test-name-pattern "ignores stale" test/e2e/views-campaign.test.js  # one test
```
- E2E needs a throwaway **local mongod** (set `MONGOD_PATH` if it isn't on PATH). The harness (`test/e2e/harness.js`) never reads `Backend/.env` and clears outside-service creds (Paystack, email, S3, Cloudinary, social APIs). Keep `views-campaign.test.js` green — it's the regression guard for live campaigns.

## Key Ports

| Service     | Port |
|-------------|------|
| Web app     | 3000 |
| Admin app   | 3003 |
| Backend API | 5000 |

## Tech Stack

Next.js 15 (App Router) + React 19 · Tailwind 3.4 + CSS variables · shadcn/ui v4, Radix UI, Base UI, Vaul (drawers) · GSAP (`useReveal`, `useStaggerReveal`) + Lenis · HugeIcons (+ Lucide fallback) · recharts + shadcn `Chart` (in `apps/web`) · Socket.IO client · Express 4 (CommonJS) + Mongoose + MongoDB Atlas · custom JWT (access + refresh, localStorage) · Paystack · Multer → Cloudinary · Zod (backend only).

## TypeScript & Config

- `strict: true` everywhere, `moduleResolution: "bundler"`, `skipLibCheck: true`, `incremental: true` (+ `tsBuildInfoFile`).
- Path aliases: `@/*` → `./src/*`, `@ep/ui/*` → `../../packages/ui/src/*`.
- `next.config` rewrites `/api/*` → `http://localhost:5000/api/*` (dev proxy); `transpilePackages: ["@ep/ui"]`.
- `@ep/ui` exports are mapped in `packages/ui/package.json` `"exports"` (`./components/*`, `./lib/*`, `./assets/*`, `./hooks/*`).

## Code Style Guidelines

### Naming
- Components: PascalCase (`CampaignWizard.tsx`); hooks: kebab `use-`; lib/utils: camelCase; backend routes camelCase, models PascalCase; constants UPPER_SNAKE.
- Named exports for components; **default exports only for Next.js page files**. `"use client"` on any component using hooks/events/browser APIs.

### Imports (order)
1. React/Next (`import * as React from "react"`, `useRouter` from `next/navigation`)
2. Third-party (`@hugeicons/react`)
3. Shared UI (`@ep/ui/components/…`, `@ep/ui/lib/utils`)
4. Local components
5. Hooks/lib
6. Assets

### TypeScript
- `interface` for props/data; `type` for unions/tuples; `as const` for enum-like constants; `Record<string, T>` for dictionaries; `unknown` in catch (never `any`); typed `apiRequest<T>(endpoint, options)`.

### Styling (hard rules)
- `cn()` (`clsx` + `tailwind-merge`) for ALL conditional classes.
- **No `font-bold`**, no `shadow-*`, no hover effects on buttons.
- `font-rethink` on all text; root font 13px (org `html { font-size: 13px }`).
- `tracking-tight` only for headings > 16px; labels are **title case** (never uppercase/wider).
- Mobile-first `md:`; pill buttons (`rounded-full`), textareas `rounded-xl`.
- Shell bg is `neutral-50` (`#fafafa`); cards white with `border-neutral-100`. Data figures use `tabular-nums`; accent color `#FEB604`, ink `#171717` (neutral-900).
- Icons: `<HugeiconsIcon icon={XIcon} size={16} className="text-neutral-500" />`; 12–14 inline, 16 standard, 20 mobile. Color always via `className`.

### Data / feedback
- `useToast()` → `toast("Message", "error" | "success")`; error state `const [error, setError] = useState("")` + inline render; `Skeleton` for loading; reveal animations via `data-reveal` (+ `useStaggerReveal(step)` for lists).

### API / Auth
- `apiRequest<T>(endpoint, { method, body, token })` from `lib/api`; uploads use raw `fetch` + `FormData` to `POST /api/upload/image` (field `"file"`).
- Auth: localStorage `"token"` + `"user"`; helpers `saveAuth/clearAuth/getToken/getUser/isAuthenticated`; logout = `clearAuth()` + `router.push("/login")`.

### Backend
- CommonJS; route `router.get("/", protect, authorizeRoles("business"), async (req, res, next) => …)`; roles `business | creator | admin | finance_admin | support | super_admin`; Zod in handlers; global error handler covers Cast/Validation/dup-key/JWT errors.

## Brand Workspace (`apps/web`, /dashboard/brand)

- SaaS shell (`components/brand/`): sidebar (Overview/Campaigns/Analytics/Billing & payments), topbar w/ notifications + New campaign, mobile drawer (`brand-nav-menu`), `useBrandGuard` for auth/roles.
- Section pages: `/dashboard/brand`, `/campaigns`, `/analytics`, `/billing`, `/settings` (incl. `/settings/referral`); drawers: `/create-campaign`, `/campaign/[id]`.
- **Stats**: `GET /businesses/me/stats` (aggregate) and `?month=YYYY-MM` (monthly KPIs, daily series, top campaigns, available months); `GET /businesses/me/transactions` (billing feed). Daily views tracked in `ViewSnapshot` (`services/viewSnapshots.js`), written on every view sync; one-time backfill: `node Backend/src/scripts/backfillViewSnapshots.js`.

## Campaign Wizard v2 (`/dashboard/brand/create-campaign`)

Six steps (`WIZARD_STEPS` in `brand-wizard/wizard-state.ts`): 1 Campaign type, 2 Access/destination, 3 Audience, 4 Pay, 5 Brief, 6 Review/launch.
- Step 1 = four single-select cards (Boost Visibility / Drive Sign-ups / Get Content Made / Boost & Convert); selection gated by `typeChosen` (Continue disabled until chosen) and drives fields in later steps via `CAMPAIGN_TYPES`/`applyCampaignType`.
- Footer = `[Save as draft] [Continue]`; **Back** opens a save/discard `ConfirmExitModal`. Per-step headings come from `stepHeading(data, step)`.
- Objective is immutable once a campaign leaves `draft`/`pending_payment` (API rejects edits after that).

## Campaign Status Flow

```
draft → pending_payment → under_review → live → completed
                             | → paused → live
                             → cancelled (refund)
```

## Real-Time (Socket.IO)

Singleton socket in `lib/socket.ts`; `useSocket(onPaymentSuccess, onCampaignStatus)` listens for status/payment events.