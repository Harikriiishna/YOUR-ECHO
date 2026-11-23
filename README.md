<div align="center">

# ECHO — The Human Memory Network

**Save what matters. Understand your life. Connect with humanity.**

A private, AI-assisted personal archive, reflection studio, and human connection platform unifying life memories, voice journaling, time capsules, dream logs, object heirlooms, peer skill exchanges, and anonymous global stories.

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=0F172A)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.x-0F172A?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Gemini API](https://img.shields.io/badge/Google%20GenAI-Server--Side-8E75B2?style=flat-square&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Capacitor](https://img.shields.io/badge/Capacitor-Mobile%20Ready-119EFF?style=flat-square&logo=capacitor&logoColor=white)](https://capacitorjs.com/)

</div>

---

## Overview

**ECHO** brings together personal memory preservation and thoughtful human connection in a single cohesive web and mobile-ready application. Every personal archive entry stays stored in your own SQLite database with explicit AI privacy controls, offline queueing, real-time notifications, and customizable light, dark, and frosted-glass themes.

---

## Core Modules & Capabilities

| Module | What It Does |
| :--- | :--- |
| **Home Dashboard** | Displays daily **On This Day** flashbacks, archive pulse metrics, and one-tap quick capture launchers. |
| **ECHO Memory** | Rich life archive featuring **Timeline**, **Calendar**, **Collections**, privacy-clustered **Memory Map**, **People** directory, **Tag Manager**, fullscreen **Slideshow**, and JSON archive export. |
| **AI Sentiment & Emotional Impact** | Classifies memories by emotional impact (`Uplifting`, `Calm`, `Reflective`, `Bittersweet`, `Challenging`), mood/tone, valence score (`-100` to `+100`), and concise rationale — supporting single entries, live editor drafts, and batch archive runs. |
| **AI Life Memory** | Grounded conversational Q&A across your personal archive with clickable source citations, follow-up prompts, and a **Spoken Memory Studio** (live microphone recording, waveform meter, automatic transcription, title/summary generation, and automatic saving). |
| **Time Capsules** | Seal letters and media attachments until a future date & timezone; the backend strictly blocks locked capsule media until the unlock timestamp arrives. |
| **Dream Archive** | Log dreams with vividness ratings, recurring flags, emotional tone, voice notes, and AI dream reflections. |
| **Life Behind Objects** | Preserve stories and ownership lineage behind meaningful physical objects and heirlooms, complete with optional public share slugs and QR codes. |
| **SkillSwap** | Create teach/learn skill profiles, discover mutual skill matches, schedule exchanges, and chat with exchange partners. |
| **Stranger's Wisdom & Humanity Feed** | Share anonymous reflections, life lessons, and moments of resilience across approximate world regions with supportive community reactions and replies. |
| **Profile, Themes & Privacy** | Switch between 6 curated themes (including dark and light frosted-glass themes), toggle global AI consent, inspect storage usage, export all data as JSON, or delete your account. |

---

## Visual Themes

ECHO includes six built-in semantic theme palettes persisted per user and synced to the browser:

- **Midnight Obsidian** — Deep obsidian canvas with high-contrast slate surfaces
- **Obsidian Glass** — Translucent dark frosted panes over an ambient aurora backdrop
- **Crystal Glass** — Bright frosted alabaster glass with crisp slate typography (light mode)
- **Aurora Borealis** — Nordic deep-sea slate with tranquil teal and cyan highlights
- **Amber Hearth** — Warm walnut dark palette tuned for evening journaling
- **Nebula Dusk** — Twilight indigo and plum surfaces for dream and reflection logs

---

## Architecture

```
+-----------------------------------------------------------------------+
|                       React 19 + Vite SPA (src/)                      |
|  EchoContext (Auth, Theme, Offline Queue, Tab History) · Tailwind v4  |
+----------------------------------+------------------------------------+
                                   | HTTP (/api/*) + WebSocket (/ws)
+----------------------------------v------------------------------------+
|                  Express + Node.js Server (server.ts)                 |
|  Auth & CSRF Guard · Rate Limiter · Multer Media · WebSocket Server   |
+------------------+----------------------------------+-----------------+
                   |                                  |
     +-------------v--------------+      +------------v------------+
     |  SQLite (better-sqlite3)   |      |  Google GenAI SDK       |
     |  data/echo.db + uploads/   |      |  gemini-4-hydrogen      |
     +----------------------------+      |  gemini-3.5-transcribe  |
                                         +-------------------------+
```

### Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Lucide Icons, QRCode
- **Backend:** Express 4, Node.js (`tsx`), `ws` WebSockets, Multer file uploads
- **Database:** SQLite via `better-sqlite3` (WAL mode, foreign keys enabled, automatic startup migrations)
- **AI Integration:** `@google/genai` running strictly server-side with user consent (`aiConsent`) and per-entry exclusion (`aiExcluded`) enforcement
- **Mobile Readiness:** Touch-optimized responsive layouts (`touch-action: manipulation`), mobile navigation bar with persistent back navigation, offline mutation queueing, and `capacitor.config.ts`

---

## Getting Started

### Prerequisites

- **Node.js** 20+ (tested on Node 22)
- **npm** (or Bun using `bun.lock`)
- A **Gemini API key** if you plan to use AI Life Memory, audio transcription, or AI sentiment analysis

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
| :--- | :--- |
| `GEMINI_API_KEY` | Server-side API key for `@google/genai` AI queries, sentiment analysis, and transcription. |
| `APP_URL` | Public URL where the app is hosted (optional locally; defaults to `http://localhost:3000`). |
| `PORT` | Server port (defaults to `3000`). |

### 3. Run in Development

Starts the Express API, WebSocket server, and Vite middleware together on port `3000`:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Type Check & Production Build

```bash
# TypeScript check
npm run lint

# Build frontend bundle into dist/
npm run build

# Run production server (serves API + built dist/)
NODE_ENV=production npm start
```

---

## Project Structure

```
.
├── server.ts                        # Express + Vite dev/prod entrypoint & HTTP server
├── server/
│   ├── ai.ts                        # Server-side Gemini queries, transcription & sentiment analysis
│   ├── auth.ts                      # Session auth, CSRF validation & rate limiting
│   ├── db.ts                        # SQLite schema initialization & migrations (data/echo.db)
│   ├── ws.ts                        # Authenticated WebSocket notifications & realtime events
│   └── routes/
│       ├── authRoutes.ts            # Registration, login, profile, theme & full archive export
│       ├── memoryAndMediaRoutes.ts  # Memories CRUD, tags, sentiment filtering & media uploads
│       ├── capsuleAndAiRoutes.ts    # Time capsules & ECHO AI endpoints
│       ├── communityAndSkillRoutes.ts # Wisdom, Humanity feed & SkillSwap exchanges
│       └── objectDreamAndSyncRoutes.ts # Objects, Dreams, Search, Notifications & Sync
├── src/
│   ├── App.tsx                      # Root app shell & module router
│   ├── index.css                    # Tailwind CSS v4 & multi-theme CSS custom properties
│   ├── context/EchoContext.tsx      # Auth state, theme persistence, offline sync & back history
│   ├── lib/
│   │   ├── api.ts                   # Authenticated API client & offline cache helpers
│   │   └── themes.ts                # Theme definitions & document switcher
│   ├── types/echo.ts                # Shared TypeScript domain interfaces
│   └── components/                  # Modular feature views & shared media elements
├── capacitor.config.ts              # Capacitor mobile container configuration
├── .env.example                     # Environment variable template
└── package.json                     # Scripts and dependencies
```

---

## Privacy & Security Design

- **Server-Only AI Keys:** `GEMINI_API_KEY` is never exposed to browser bundles; all AI inference runs behind authenticated `/api/*` routes.
- **Granular AI Controls:** Users can pause AI access globally in Profile settings (`aiConsent`) or exclude individual memories (`aiExcluded`), enforced on the backend before any AI prompt is built.
- **Session & Request Protection:** Session cookies, `X-Requested-With` CSRF protection, and per-route rate limiting protect user endpoints.
- **Time-Locked Media Enforcement:** Media attached to sealed Time Capsules cannot be fetched via `/api/media/:id` until the capsule's unlock timestamp passes.
- **Local-First Resilience:** Memory and dream drafts created while offline are queued locally and synchronized once connectivity returns.
