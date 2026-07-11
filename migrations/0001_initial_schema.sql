-- ============================================================
-- WAR ROOM: Discipline & Strategy Mastery System
-- ============================================================

-- Daily schedule template blocks (the master schedule)
CREATE TABLE IF NOT EXISTS schedule_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order INTEGER NOT NULL,
  start_time TEXT NOT NULL,          -- 'HH:MM' 24h
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,            -- morning|workout|deepwork|study|meal|strategy|philosophy|entertainment|skincare|admin|social|review|sleep|flex|rest
  description TEXT,
  days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri', -- comma list: mon..sun
  is_non_negotiable INTEGER DEFAULT 0,
  points INTEGER DEFAULT 10          -- reward points for completion
);

-- Per-day completion log of blocks
CREATE TABLE IF NOT EXISTS block_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL,
  log_date TEXT NOT NULL,            -- 'YYYY-MM-DD'
  status TEXT NOT NULL DEFAULT 'pending', -- pending|done|partial|skipped
  note TEXT,
  completed_at TEXT,
  UNIQUE(block_id, log_date),
  FOREIGN KEY (block_id) REFERENCES schedule_blocks(id)
);

-- Nightly debrief journal
CREATE TABLE IF NOT EXISTS debriefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT UNIQUE NOT NULL,
  wins TEXT,
  breaks TEXT,                        -- where I broke the schedule and why
  tomorrow_targets TEXT,              -- top 3 targets for tomorrow
  strategy_insight TEXT,              -- one principle applied/observed today
  mood INTEGER,                       -- 1-5
  energy INTEGER,                     -- 1-5
  sleep_time TEXT,                    -- planned lights-out
  wake_time TEXT,                     -- actual wake
  sleep_hours REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Campaign: phases -> units (progress-locked curriculum)
CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order INTEGER NOT NULL,
  code TEXT UNIQUE NOT NULL,          -- P1, P2, P3, PHIL
  title TEXT NOT NULL,
  subtitle TEXT,
  track TEXT NOT NULL DEFAULT 'strategy'  -- strategy | philosophy
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  reading TEXT,                       -- what to read
  lesson TEXT,                        -- core lesson summary
  field_drill TEXT,                   -- real-life application drill
  debrief_prompt TEXT,                -- night debrief question for this unit
  is_exam INTEGER DEFAULT 0,          -- integration exam unit
  exam_questions TEXT,                -- JSON array of questions
  FOREIGN KEY (phase_id) REFERENCES phases(id)
);

-- Unit progress (progress-based unlocking: unit N unlocks when N-1 done)
CREATE TABLE IF NOT EXISTS unit_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',  -- locked|active|reading_done|drill_done|complete
  reading_done_at TEXT,
  drill_done_at TEXT,
  drill_report TEXT,                  -- what happened when applying the drill
  debrief_answer TEXT,
  exam_answers TEXT,                  -- JSON of answers
  exam_self_score INTEGER,            -- 0-100 self-graded
  completed_at TEXT,
  attempts INTEGER DEFAULT 0,
  FOREIGN KEY (unit_id) REFERENCES units(id)
);

-- Maxim bank (naive vs master reading)
CREATE TABLE IF NOT EXISTS maxims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,               -- 'Sun Tzu' | 'Machiavelli' | 'Discourses' | 'Greene' | 'Musashi' | 'Stoic'
  principle TEXT NOT NULL,
  naive_reading TEXT NOT NULL,
  master_reading TEXT NOT NULL,
  my_words TEXT,                      -- user's own-words rewrite
  unit_id INTEGER,
  created_by_user INTEGER DEFAULT 0
);

-- Flashcard spaced repetition state (SM-2 lite)
CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maxim_id INTEGER UNIQUE NOT NULL,
  interval_days REAL DEFAULT 0,
  ease REAL DEFAULT 2.5,
  due_date TEXT DEFAULT (date('now')),
  reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  FOREIGN KEY (maxim_id) REFERENCES maxims(id)
);

-- Flashcard review log
CREATE TABLE IF NOT EXISTS card_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maxim_id INTEGER NOT NULL,
  grade INTEGER NOT NULL,             -- 0=fail 1=hard 2=good 3=easy
  reviewed_at TEXT DEFAULT (datetime('now'))
);

-- Honesty flags (ruthless honesty engine)
CREATE TABLE IF NOT EXISTS honesty_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_date TEXT NOT NULL,
  flag_type TEXT NOT NULL,            -- missed_debrief|skipped_drill|broken_streak|missed_block|never_miss_twice|low_adherence|exam_failed
  severity TEXT NOT NULL DEFAULT 'warn', -- warn|serious|critical
  message TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Points ledger (rewards & consequences)
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  points INTEGER NOT NULL,            -- positive = earned, negative = penalty
  reason TEXT NOT NULL,
  ref_type TEXT,                      -- block|debrief|unit|exam|flag|streak
  ref_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Rewards catalog (earned entertainment / privileges)
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  cost INTEGER NOT NULL,
  description TEXT,
  redeemed_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reward_id INTEGER NOT NULL,
  redeemed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reward_id) REFERENCES rewards(id)
);

-- The 7 Laws with per-day adherence checks
CREATE TABLE IF NOT EXISTS laws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS law_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  law_id INTEGER NOT NULL,
  log_date TEXT NOT NULL,
  kept INTEGER NOT NULL,              -- 1 kept, 0 broken
  note TEXT,
  UNIQUE(law_id, log_date),
  FOREIGN KEY (law_id) REFERENCES laws(id)
);

-- App settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_block_logs_date ON block_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_flags_date ON honesty_flags(flag_date);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON points_ledger(log_date);
CREATE INDEX IF NOT EXISTS idx_units_phase ON units(phase_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_cards_due ON flashcards(due_date);
