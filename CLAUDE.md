# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About This App

**Chiritsumo / かけいぼ** — a Japanese household finance tracker (家計簿) built as a PWA and iOS/Android native app via Capacitor. Design philosophy: Luxury Minimalist with smooth motion UI.

## Tech Stack

Vanilla HTML/CSS/JavaScript (no framework, no bundler, no TypeScript). Backend is Supabase. Native apps use Capacitor v8.

> Note: [AGENTS.md](AGENTS.md) references Next.js/Tailwind — this is aspirational and does not reflect the actual implementation.

## Development Commands

There is no dev server or build step. Edit source files at the repo root directly.

```bash
# Serve locally (any static server works)
python3 -m http.server 8080

# After editing root files, sync to www/ and native projects
npx cap copy
npx cap sync

# Open native IDE
npx cap open ios       # Xcode
npx cap open android   # Android Studio

# Regenerate icons/splash from assets/
npx @capacitor/assets generate
```

There are no tests, no linter, and no CI configuration.

## Critical: Dual-Location Source Files

The `www/` directory is Capacitor's `webDir` — a copy of the root web files bundled into native apps. **Always run `npx cap copy` after editing root files** before building native apps. The following files exist in both root and `www/`:

- `index.html`, `app.js`, `style.css`
- `supabase-config.js`, `supabase-client.js`, `sw.js`, `manifest.json`

## Architecture

### Single-page app with 5 screens

All screens are `<section class="screen">` elements defined in [index.html](index.html). Navigation is CSS class toggling (`active` / `slide-out`) with no router. Screens:

- `screen-home` — balance card, budget donut, category cards, recent transactions
- `screen-history` — searchable/filterable transaction list grouped by date
- `screen-report` — 6-month cashflow bar chart + expense donut
- `screen-settings` — budget, categories, theme, export, logout
- `screen-input` — slides up as a panel; custom numpad + category grid

### State ([app.js](app.js))

One global mutable object `state` in [app.js](app.js) (~1,526 lines). No reactive library. Re-renders are triggered imperatively by calling `renderHome()`, `renderHistory()`, etc. after mutations.

### Data Persistence — Two layers

**localStorage (always):**
- `kakeibo_transactions` — all transaction records (JSON array)
- `kakeibo_settings` — user preferences
- `kakeibo_offline_queue` — ops queued while offline, flushed on `window` `online` event

**Supabase (when authenticated):**
- Table `transactions` — synced on login and on every insert/delete
- Table `user_settings` — upserted by `user_id`
- Realtime subscription on `transactions` for multi-device sync

**Transaction ID scheme:**
- `sample_*` — auto-generated demo data, never synced to Supabase
- `txn_<timestamp>_<random>` — locally created; overwritten with Supabase UUID on successful insert
- UUIDs — records that originated from Supabase

### Charts

Chart.js 4.4.0 loaded from CDN. Three module-level chart instances: `chartBudgetDonut`, `chartCashflow`, `chartExpenseDonut`. Always `destroy()` before recreating.

### Supabase client ([supabase-client.js](supabase-client.js))

Thin abstraction over the Supabase JS SDK. Handles auth, CRUD, realtime subscriptions, and the offline queue. Credentials are in [supabase-config.js](supabase-config.js) — these are publishable anon keys, safe to commit by Supabase design.

## iOS / Capacitor Notes

- Bundle ID: `com.shar.kakeibo`
- `server.allowNavigation: ["*"]` is required for Supabase auth redirects
- CSS uses `env(safe-area-inset-*)`, `100dvh`/`100svh`, and `-webkit-overflow-scrolling: touch`
- All emoji elements explicitly use `Apple Color Emoji` font to prevent WKWebView blur bugs
- Service Workers are not supported in WKWebView — offline mode on iOS relies solely on localStorage + offline queue
- `ios.webContentsDebuggingEnabled: true` is set — Safari Web Inspector works for debugging
