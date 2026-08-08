-- ============================================================
-- 0004 REFORGE — security, weighted scoring, day_summary,
-- predictions, appeals, load reductions (frontier review P0–T2)
-- ============================================================

-- 1. Block weight: CORE=3, STANDARD=1, CONTEXT=0 (visible but unscored)
ALTER TABLE schedule_blocks ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;
-- MVD nomination: exactly the blocks that constitute a Minimum Viable Day
ALTER TABLE schedule_blocks ADD COLUMN is_mvd INTEGER NOT NULL DEFAULT 0;

-- Sensible defaults from existing data:
--   non-negotiables -> CORE(3); meals/skincare/entertainment/sleep/rest/flex -> CONTEXT(0)
UPDATE schedule_blocks SET weight = 3 WHERE is_non_negotiable = 1;
UPDATE schedule_blocks SET weight = 0 WHERE category IN ('meal','skincare','entertainment','sleep','rest','flex');

-- 2. Structured flag identity (kills message-LIKE dedup)
ALTER TABLE honesty_flags ADD COLUMN ref_type TEXT;
ALTER TABLE honesty_flags ADD COLUMN ref_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_identity
  ON honesty_flags(flag_date, flag_type, COALESCE(ref_type,''), COALESCE(ref_id,0));

-- 3. Materialized day summary (kills computeStreak's ~240 sequential queries)
CREATE TABLE IF NOT EXISTS day_summary (
  summary_date TEXT PRIMARY KEY,          -- 'YYYY-MM-DD'
  adherence_pct INTEGER NOT NULL DEFAULT 0,
  weighted_score REAL NOT NULL DEFAULT 0, -- Σ(weight×credit)
  weighted_total REAL NOT NULL DEFAULT 0, -- Σ(weight)
  blocks_done INTEGER NOT NULL DEFAULT 0,
  blocks_total INTEGER NOT NULL DEFAULT 0,
  mvd_held INTEGER NOT NULL DEFAULT 0,    -- 1 = HELD THE LINE (all nominated CORE hit)
  debrief_filed INTEGER NOT NULL DEFAULT 0,
  victory INTEGER NOT NULL DEFAULT 0,     -- 1 = streak-qualifying day
  points INTEGER NOT NULL DEFAULT 0,
  finalized INTEGER NOT NULL DEFAULT 0,   -- 1 once the day is closed (immutable)
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_day_summary_victory ON day_summary(victory, summary_date);

-- 4. Prediction Log (calibration instrument)
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  made_date TEXT NOT NULL,                -- day claim was made
  claim TEXT NOT NULL,
  confidence INTEGER NOT NULL,            -- 50–99 (%)
  resolve_by TEXT NOT NULL,               -- date it must be graded
  domain TEXT,                            -- optional tag
  outcome TEXT NOT NULL DEFAULT 'unresolved', -- right|wrong|unresolved|void
  resolved_date TEXT,
  resolution_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_predictions_open ON predictions(outcome, resolve_by);

-- 5. Appeals (one token/week, reopens ONE auto-canceled window, permanent reason)
CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appeal_date TEXT NOT NULL,              -- day the appeal was used
  block_id INTEGER NOT NULL,
  block_date TEXT NOT NULL,               -- the canceled day being reopened
  reason TEXT NOT NULL,                   -- >=100 chars, PERMANENT record
  week_key TEXT NOT NULL,                 -- ISO week 'YYYY-Www' — UNIQUE = 1/week
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(week_key)
);

-- 6. Load reductions (never-miss-twice inverted: halve the block for 3 days + ask why)
CREATE TABLE IF NOT EXISTS load_reductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,                 -- start + 3 days
  reason TEXT,                            -- wrong_time|too_long|wrong_prereq|dont_want_it (answered later)
  answered_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(block_id, start_date)
);

-- 7. Settings: timezone + MVD defaults
INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Africa/Nairobi');
-- auth_hash / auth_salt / session_secret are created at runtime on first password setup
