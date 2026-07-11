-- ============ LIFE INTEL (The Council war journal) ============
CREATE TABLE IF NOT EXISTS intel_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  domain TEXT NOT NULL,          -- loyalty|family|friends|network|community|neighbours|classmates|women_relationships|money|hustle|society|manipulation_spotted|clever_move|dumb_move|workaround|wisdom|other
  title TEXT NOT NULL,
  situation TEXT,                -- what happened (the terrain)
  my_move TEXT,                  -- what I did
  outcome TEXT,                  -- what resulted
  verdict TEXT,                  -- smart|dumb|neutral|pending
  principle_used TEXT,           -- which Sun Tzu / Machiavelli principle applied (or should have)
  lesson TEXT,                   -- what I extract from this
  people TEXT,                   -- who was involved (names/roles)
  hermes_analysis TEXT,          -- AI counsel on this entry
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_date ON intel_entries(log_date);
CREATE INDEX IF NOT EXISTS idx_intel_domain ON intel_entries(domain);

-- ============ REAL BOOK READING PROGRESS ============
CREATE TABLE IF NOT EXISTS book_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,         -- matches /static/books/{id}.json
  chapter_idx INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread', -- unread|reading|done
  last_para INTEGER DEFAULT 0,   -- scroll position (paragraph index)
  notes TEXT,
  completed_at TEXT,
  UNIQUE(book_id, chapter_idx)
);

-- ============ HERMES AGENT MEMORY ============
CREATE TABLE IF NOT EXISTS hermes_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,            -- user|assistant
  content TEXT NOT NULL,
  context_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============ ALARM PREFERENCES ============
INSERT OR IGNORE INTO settings (key, value) VALUES
('alarm_enabled', '1'),
('alarm_volume', '0.9'),
('alarm_lead_minutes', '2'),
('alarm_repeat', '3');
