-- ─────────────────────────────────────────────────────────
-- THE AMNESIAC — Supabase Schema
-- Run this in your Supabase SQL editor once
-- ─────────────────────────────────────────────────────────

-- Journal entries written by holders
CREATE TABLE journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet          TEXT NOT NULL,
  text            TEXT NOT NULL,
  tier            INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  balance         NUMERIC,
  is_core_memory  BOOLEAN DEFAULT FALSE,
  ai_response     TEXT,
  tx_hash         TEXT,               -- Solana tx hash for core memories
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  day_number      INTEGER NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Waking entries (posted each Monday)
CREATE TABLE waking_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number            INTEGER NOT NULL,
  tweet1                TEXT NOT NULL,
  tweet2                TEXT,
  tweet_id_1            TEXT,
  tweet_id_2            TEXT,
  source_entry_id       UUID REFERENCES journal_entries(id),
  journal_entries_count INTEGER DEFAULT 0,
  status                TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  posted_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled / generated tweets
CREATE TABLE scheduled_tweets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('midday', 'evening', 'other')),
  day_number      INTEGER,
  tweet_id        TEXT,
  scheduled_for   TIMESTAMPTZ,
  posted_at       TIMESTAMPTZ,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'deleted')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────
CREATE INDEX idx_entries_status     ON journal_entries(status);
CREATE INDEX idx_entries_day        ON journal_entries(day_number);
CREATE INDEX idx_entries_wallet     ON journal_entries(wallet);
CREATE INDEX idx_entries_core       ON journal_entries(is_core_memory);
CREATE INDEX idx_tweets_status      ON scheduled_tweets(status);
CREATE INDEX idx_waking_day         ON waking_entries(day_number);

-- ─── Row Level Security ───────────────────────────────────
-- Public can only read approved entries (for the journal feed)
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE waking_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tweets ENABLE ROW LEVEL SECURITY;

-- Public read policy — approved entries only
CREATE POLICY "Public read approved entries" ON journal_entries
  FOR SELECT USING (status = 'approved');

CREATE POLICY "Public read waking entries" ON waking_entries
  FOR SELECT USING (status = 'posted');

-- Service role (backend) bypasses RLS — no extra policy needed
-- The SUPABASE_SERVICE_KEY bypasses RLS automatically
