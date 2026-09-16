# AGENTS.md — EasilyPromote Codebase Guide

## Project Overview

Two-sided marketplace connecting brands with content creators for view-based social media campaigns. Brands fund campaigns, creators produce content, views tracked → payouts via Paystack escrow.

## Repository Structure

```
Easily-promote/
  Backend/              Express.js API server (CommonJS, standalone)
  Fontend/              Turborepo monorepo (intentional typo in dir name)
    apps/
      brand/            @ep/brand  — Next.js 15, port 3002
      creator/          @ep/creator — Next.js 15, port 3001
      admin/            @ep/admin  — Next.js 15, port 3003
    packages/
      ui/               @ep/ui — Shared components, hooks, assets, utils
```

## Build / Dev / Lint / TypeScript Commands

### Frontend (run from `Fontend/`)
```bash
npm run dev              # All apps via turborepo
npm run dev --filter=@ep/creator   # Single app
npm run build            # All apps
npm run lint             # All apps (turbo run lint)
npx turbo run lint --filter=@ep/creator  # Single app
npx tsc --noEmit         # From Fontend/apps/* or Fontend/packages/ui
```

### Backend (run from `Backend/`)
```bash
npm run dev              # nodemon src/server.js (port 5000)
npm run start            # node src/server.js (production)
```

### Testing
Frontend: no test framework; run `npx tsc --noEmit` for type checking.

Backend end-to-end tests (run from `Backend/`):
```bash
npm run test:e2e         # node:test against a throwaway local mongod, Paystack stubbed
```
- Needs `mongod` installed locally (set `MONGOD_PATH` if it isn't found). Tests never read `Backend/.env` and clear outside-service keys (email, S3, Cloudinary, social APIs).
- Tests live in `Backend/test/e2e/*.test.js` and drive the HTTP API through `test/e2e/harness.js` (`api`, `registerBrand`, `registerCreator`, `paystack.markPaid`).
- `views-campaign.test.js` is the regression guard for live campaigns; keep it passing.

## Key Ports

| Service     | Port |
|-------------|------|
| Creator app | 3001 |
| Brand app   | 3002 |
| Admin app   | 3003 |
| Backend API | 5000 |

## Tech Stack

| Layer            | Technology |
|------------------|------------|
| Frontend         | Next.js 15 (App Router), React 19 |
| Styling          | Tailwind CSS 3.4, CSS variables |
| UI primitives    | shadcn/ui v4, Radix UI, Base UI, Vaul (drawer/bottom sheet) |
| Animation        | GSAP 3.15 (`useReveal`), Lenis smooth scroll |
| Icons            | HugeIcons (`@hugeicons/core-free-icons` + `@hugeicons/react`), Lucide backup |
| Forms / State    | Manual `useState`/`onChange` only (no React Hook Form, Redux, Zustand) |
| Real-time        | Socket.IO client 4.8 (`useSocket` hook) |
| Backend          | Express 4.21 (CommonJS), Mongoose 8.9, MongoDB Atlas |
| Auth             | Custom JWT (access + refresh tokens), localStorage on frontend |
| Payments         | Paystack |
| File upload      | Multer (memory) → Cloudinary |
| Validation       | Zod (backend only) |

## TypeScript & Config

- **`strict: true`** in all tsconfig.json, `moduleResolution: "bundler"`
- Path aliases: `@/*` → `./src/*`, `@ep/ui/*` → `../../packages/ui/src/*`
- Next.js config rewrites `/api/*` → `http://localhost:5000/api/*` (dev proxy)
- No eslint config file (uses `next lint` defaults), no frontend test framework (backend: `npm run test:e2e`)
- UI package exports from `@ep/ui` map via `package.json` `"exports"` field: `./components/*`, `./lib/*`, `./assets/*`, `./hooks/*`

## Code Style Guidelines

### File Naming
- **React components**: PascalCase (`CampaignWizard.tsx`)
- **Hooks**: kebab-case `use-` (`use-reveal.ts`, `use-is-mobile.ts`)
- **Lib/utils**: camelCase (`api.ts`, `auth.ts`, `socket.ts`)
- **Backend routes**: camelCase (`campaigns.js`), **models**: PascalCase (`User.js`)
- **Constants**: UPPER_SNAKE_CASE (`FILTER_OPTIONS`, `PRESET_VIEWS`)

### Component Patterns
- **Named exports** for components: `export function CampaignWizard(...)`. **Default exports** only for Next.js page files
- **`"use client"`** directive required on any component using hooks, event handlers, or browser APIs
- **`React.forwardRef`** for shared UI primitives (button, input) with `displayName` set
- **Props interfaces** defined with `interface`, not `type` — prefixed with component name
- **Destructure props** in function signature, not inside body
- **`React` namespace import** (`import * as React from "react"`) preferred over named imports for types

### Import Ordering
1. React / Next.js: `import * as React from "react"`, `import { useRouter } from "next/navigation"`
2. Third-party: `import { HugeiconsIcon } from "@hugeicons/react"`
3. Shared UI: `import { cn } from "@ep/ui/lib/utils"`
4. Local components: `import { Skeleton } from "./ui/skeleton"`
5. Hooks/lib: `import { useReveal } from "../hooks/use-reveal"`
6. Assets: `import illustration3 from "@ep/ui/assets/illustrations/illustration3.svg"`

### TypeScript Patterns
- **`interface`** for data shapes and props; **`type`** for unions, aliases, tuples
- **`as const`** for readonly tuples/enum-like constants
- **`Record<string, T>`** for dictionaries (avoid index signatures)
- **`unknown`** in catch blocks — never `any`
- **Generic parameters** on `apiRequest<T>(endpoint, options)` for typed responses
- **`React.ChangeEvent<HTMLInputElement>`** for event types

### Styling Rules (Hard Design Rules)
- **`cn()` utility** (`clsx` + `tailwind-merge`) for ALL conditional classes
- **No `font-bold`** anywhere — `font-semibold` for buttons only, `font-medium` for all other text
- **No hover effects** on buttons — hard rule
- **No shadows** — hard rule (no `shadow-*` classes)
- **`font-rethink`** class on all text (Rethink Sans primary font)
- Root font: 13px desktop, 14px mobile (`html { font-size: 13px }`)
- **`tracking-tight`** only for headings > 16px
- **Labels** are title case — never uppercase, never `tracking-wider`
- **Mobile-first**: `md:` breakpoint for desktop-up styles
- **Responsive icons**: Two `HugeiconsIcon` elements with `md:hidden` / `hidden md:block` (Huge Icons `size` uses inline styles)
- **Animation**: `data-reveal` / `data-reveal-left` attributes on elements for GSAP entrance animations
- **Image**: Add `unoptimized` on `<Image>` for avatars and SVGs
- **Button radius**: `rounded-full` (pill shape). Input radius: `rounded-full` text inputs, `rounded-xl` textareas

### Error & Loading Patterns
- **Toast**: `ToastProvider` + `useToast()` hook: `toast("Message", "error" | "success")` (auto-dismiss 4s)
- **Error state**: `const [error, setError] = useState("")` + inline render
- **Loading state**: `const [loading, setLoading] = useState(true)`
- **Skeleton**: `<Skeleton className="h-8 w-48" />` for loading placeholders

### HugeIcons Usage
```tsx
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon, Add01Icon } from "@hugeicons/core-free-icons";
<HugeiconsIcon icon={FilterIcon} size={16} className="text-stone-500" />
```
- Icon size: 12–14 inline/badge, 16 standard, 20 mobile touch targets
- Color always via `className`, never hardcoded fill

### API Requests (Frontend)
- **`apiRequest<T>(endpoint, options)`** from `lib/api.ts` — wraps `fetch`, auto-sets JSON Content-Type, attaches `Authorization: Bearer <token>` if `options.token` provided
- **File uploads**: raw `fetch` with `FormData` (no Content-Type header — browser auto-sets `multipart/form-data`)
- **Upload endpoint**: `POST /api/upload/image` (field: `"file"`, returns `{ url, publicId, width, height, format }`)

### Auth Pattern (Frontend)
- JWT + user JSON in **localStorage** (keys: `"token"`, `"user"`)
- Helpers: `saveAuth()`, `clearAuth()`, `getToken()`, `getUser()`, `isAuthenticated()`
- Logout: `clearAuth()` + `router.push("/login")`
- No refresh token rotation

### Backend Patterns
- **CommonJS** (`require`/`module.exports`) — NOT ES modules
- Route handlers: `router.get("/", protect, authorizeRoles("business"), async (req, res, next) => { try { ... } catch (error) { next(error); } })`
- Auth middleware: `protect` (JWT Bearer) + `authorizeRoles(...roles)` (RBAC)
- Roles: `business`, `creator`, `admin`, `finance_admin`, `support`, `super_admin`
- Validation: Zod schemas in route handlers
- Global error handler handles `CastError`, `ValidationError`, duplicate key, `JsonWebTokenError`, `TokenExpiredError`

### Shared UI Package (`@ep/ui`)
- Components in `packages/ui/src/components/`, consumed via `@ep/ui/components/button`
- Exports defined in `packages/ui/package.json` `"exports"` field
- Next.js `transpilePackages: ["@ep/ui"]` in next.config handles runtime compilation
- Assets (images/SVGs) in `packages/ui/src/assets/` — imported as URL strings
- `MobileDrawer` returns `null` on non-mobile (768px breakpoint via `useIsMobile`)
- `useIsMobile` hook available at `@ep/ui/hooks/use-is-mobile`

### Campaign Status Flow
```
draft → pending_payment → under_review → live → completed
                                  | → paused → live
                                  → cancelled (with refund)
```

### Real-Time (Socket.IO)
- Singleton socket in `lib/socket.ts`, connects once with auth token
- `useSocket(callback)` hook listens for `"payment-success"` events
- Backend Socket.IO emits campaign status updates after payment
