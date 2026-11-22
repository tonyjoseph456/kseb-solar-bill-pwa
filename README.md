# KSEB Solar Prosumer Bill PWA

A mobile-friendly offline-first **Progressive Web App (PWA)** for KSEB solar prosumers that:
1. **Parses your monthly KSEB OrumaNET PDF bill** locally in the browser (`pdfjs-dist`) and stores both the extracted data and original PDF in `IndexedDB`.
2. **Auto-fills Previous Final Readings (`FR`)** (Normal, Off-Peak, and Peak for Import, Export, and Solar Generation, plus Bank Closing) every time you open the PWA — so you only type your **Current** meter numbers.
3. **Fetches the latest tariff rates from `anwarbio/kseb-bill-calculator` on every open** (`fixed_charge.csv`, `meter_charges.csv`, `other_charges.csv`, `tariff_domestic_telescopic.csv`, `tariff_tod_base.csv`, `tariff_tod.csv`), with automatic offline caching.
4. **Follows `anwarbio/kseb-bill-calculator` (`NL → OP → PK`) by default**, with a built-in toggle for **KSEB OrumaNET (`PK → NL → OP`)** zone adjustment order.
5. **Optionally syncs for free across devices** via Supabase (500 MB free database + 1 GB free PDF storage).

## Quick Start (Local Development)

```bash
npm install
npm run dev
```

## Run Tests & Production Build

```bash
npm test
npm run build
```

## Deploy to GitHub Pages (Free Auto-Deploy)

This repository includes [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) which automatically tests, builds, and deploys `dist/` to GitHub Pages on every push to `main`:

1. Create a GitHub repository (for example, `kseb-solar-bill-pwa`) and push this folder to `main`.
2. In your GitHub repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. *(Optional, recommended for Supabase)* In **Settings → Secrets and variables → Actions → Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   so every device that opens your GitHub Pages URL already has your Supabase project pre-filled.

## Free Cloud Sync Setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In Supabase **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql).
3. In Supabase **Authentication → URL Configuration**, set **Site URL** (and **Redirect URLs**) to your GitHub Pages URL (e.g., `https://<username>.github.io/<repo>/`).
4. In Supabase **Project Settings → API** (or **Data API**), copy your **Project URL** and **anon public key** (into GitHub Actions Variables or directly into the PWA's **Settings** tab).
5. Open **Settings** in the PWA and create/sign in with your email & password to sync bills and PDFs across phone and desktop.
