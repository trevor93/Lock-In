-- THE TONGUE — wise-response armory + supreme memorization engine

-- Captured wise responses (the armory)
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  situation TEXT NOT NULL,            -- where/when it happened, positioning context
  trigger_q TEXT NOT NULL,            -- the question or moment that triggered it
  response TEXT NOT NULL,             -- the exact smart wise unreadable response
  why_works TEXT,                     -- why it lands: what it signals, what it hides
  source TEXT,                        -- movie / podcast / office / book / person
  category TEXT NOT NULL DEFAULT 'wit', -- deflection|wit|power|mystery|boundaries|praise|conflict|small_talk|negotiation|silence
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- SM-2 scheduling + mastery ladder per response
CREATE TABLE IF NOT EXISTS response_srs (
  response_id INTEGER PRIMARY KEY,
  interval_days INTEGER DEFAULT 0,
  ease REAL DEFAULT 2.5,
  reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  due_date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  mastery TEXT DEFAULT 'new',         -- new|learning|memorized|ingrained|reflex
  total_reviews INTEGER DEFAULT 0,
  correct_reviews INTEGER DEFAULT 0,
  last_mode TEXT,
  FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- Every drill answered (audit trail for real progress)
CREATE TABLE IF NOT EXISTS tongue_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL,
  review_date TEXT NOT NULL,
  mode TEXT NOT NULL,                 -- recall|cloze|first_letters|reverse|delivery
  grade INTEGER NOT NULL,             -- 0 blank | 1 shaky | 2 solid | 3 fluent
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- Weekly exams (strict — pass >= 80%)
CREATE TABLE IF NOT EXISTS tongue_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_date TEXT NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  score_pct INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_srs_due ON response_srs(due_date);
CREATE INDEX IF NOT EXISTS idx_treviews_date ON tongue_reviews(review_date);
CREATE INDEX IF NOT EXISTS idx_responses_cat ON responses(category);
