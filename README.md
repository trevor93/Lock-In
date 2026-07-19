# ⚔ WAR ROOM — Lock In

A private, progress-based, honesty-driven life-command system. Not a calendar app — a **campaign**: unit N unlocks only when unit N−1 is conquered. No shame mechanics — **ruthless honesty mechanics**: missed debriefs are flagged, skipped drills are called out, points are earned and lost.

## Project Overview
- **Name**: webapp (War Room)
- **Goal**: One system that runs the day (schedule + alarms), the mind (strategy & philosophy curriculum with the REAL books), the record (debriefs, intel, stats), and the counsel (Hermes AI advisor — in-app and via the Termux bridge).
- **Designed for**: a slow reader / slow doer — small units, mastery gates, no time pressure, only sequence pressure.

## URLs
- **Sandbox (dev)**: https://3000-iudnv7yitk8ls7mhkrw94-0e616f0a.sandbox.novita.ai
- **Production**: not yet deployed (awaiting deploy-path choice)

## The 8 Tabs
| Tab | Purpose |
|---|---|
| **NOW** | What should I be doing RIGHT NOW — current block, next block, one-tap log |
| **DAY** | Full day plan, block check-offs, the 7 Laws daily checklist |
| **WAR** | The Campaign — 5 phases, 41 progress-locked units (reading → lesson → field drill → debrief), self-scored exams (pass ≥70) |
| **BOOKS** | 11 REAL full books (Project Gutenberg official translations) with chaptered reader + progress (+20 pts/chapter) + alarm settings + .ics calendar export |
| **COUNCIL** | Hermes AI chat (knows the whole database via live Commander's File), Morning Council, Intel Log (16 life domains), **Hermes Bridge** setup |
| **MIND** | Maxim bank (26 maxims, naive vs MASTER reading) + SM-2 spaced-repetition flashcards |
| **LOG** | Nightly debrief (Law 4 targets mandatory), rewards store, past reports |
| **STATS** | Weekly adherence %, streaks, points ledger, honesty flags |

## Key Systems
- **Honesty Engine** — runs server-side on every `/api/state`: evaluates yesterday/day-before, files flags (missed debrief, unlogged non-negotiables, skipped drills), applies point penalties, awards victory-day bonuses, enforces "never miss twice".
- **Progress Locking** — `ensureUnlocks` walks each track; the first incomplete unit is the only active one. Locked units reject all writes.
- **Points Economy** — earn: blocks, units, exams, debriefs, book chapters. Lose: flags. Spend: rewards store.
- **Alarms** — 3 layers: (1) in-app Web Audio "war horn" + banner, (2) service-worker notifications (PWA), (3) `.ics` export with RRULE+VALARM → device-native alarms that ring even with the app closed.
- **Real Books** — 11 public-domain official translations parsed to JSON, served statically, cached offline by the service worker: Art of War, The Prince, Discourses on Livy, Meditations, Enchiridion, Apology, Crito, The Republic, Zarathustra, Beyond Good & Evil, On War.

## 🔗 Hermes Bridge (Termux / Telegram / CLI)
Token-authenticated agent API so a local Hermes agent (Termux on Android) can read everything and write journals/logs automatically.

**Endpoints** (auth: `X-Agent-Token` header; get token from COUNCIL → HERMES BRIDGE, or `GET /api/agent/token` while logged into the app):
- `GET /api/agent/briefing` — live Commander's File (full situational awareness)
- `GET /api/agent/pending` — current block, overdue unlogged blocks, fresh flags, debrief status (for the watch daemon)
- `GET /api/agent/export` — full DB export for agent memory sync
- `POST /api/agent/intel` — file intel entries (`title`, `domain` required)
- `POST /api/agent/debrief` — merge into tonight's debrief (marked `[HERMES]`)
- `POST /api/agent/block-log` — check off blocks
- `POST /api/agent/message` — post counsel into the COUNCIL log
- `POST /api/agent/token/rotate` — rotate the token

**Termux client**: download `/static/hermes_bridge.py` — commands: `briefing | pending | watch | done | intel | journal | say | export`. The `watch` daemon polls every 60s and fires `termux-notification` (max priority + sound + vibrate) and optional Telegram messages (`TG_BOT_TOKEN`/`TG_CHAT_ID`) on block starts, unlogged blocks, honesty flags, and missing debriefs after 21:00.

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite) — 20 tables across 2 migrations
- **Core tables**: schedule_blocks, block_logs, debriefs, phases, units, unit_progress, maxims, flashcards, card_reviews, honesty_flags, points_ledger, rewards, laws, law_checks, settings, intel_entries, book_progress, hermes_messages
- **AI**: `gpt-5-mini` via OpenAI-compatible proxy (env: `OPENAI_API_KEY`, `OPENAI_BASE_URL`; local dev via `.dev.vars`)

## Development
```bash
npm run build                          # vite build → dist/
pm2 start ecosystem.config.cjs         # wrangler pages dev dist --d1 --local :3000
npm run db:migrate:local               # apply migrations
npm run db:seed                        # seed schedule/laws/rewards
# also seeded: seed_curriculum.sql, seed_curriculum2.sql, seed_maxims.sql
```

## Deployment
- **Platform**: Cloudflare Pages (pending — user to choose deploy path)
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + Tailwind CDN + vanilla JS + PWA
- **Status**: ✅ Fully working in sandbox (⚠ in-app Hermes chat requires a valid LLM API key injection)
- **Design**: Luxury v2 — layered-black glassmorphism, engraved gold (Cinzel), FX engine (confetti, haptics, count-up, progress rings), rank ladder (RECRUIT→SOVEREIGN), streak flame tiers, timeline day view, WhatsApp-grade council chat, premium book reader with drop caps
- **Last Updated**: 2026-07-15
