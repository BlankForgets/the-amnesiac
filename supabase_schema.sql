-- ─────────────────────────────────────────────────────────
-- BLANK — Supabase Schema
-- Run this in your Supabase SQL editor
-- ─────────────────────────────────────────────────────────

-- Journal entries written by holders
CREATE TABLE IF NOT EXISTS journal_entries (
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

-- Waking entries (morning announcements)
CREATE TABLE IF NOT EXISTS waking_entries (
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
CREATE TABLE IF NOT EXISTS scheduled_tweets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('morning', 'midday_decision', 'evening_result', 'final_thought', 'other')),
  day_number      INTEGER,
  tweet_id        TEXT,
  scheduled_for   TIMESTAMPTZ,
  posted_at       TIMESTAMPTZ,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'deleted')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Daily synthesis — BLANK's mind for the day, built from journal entries
CREATE TABLE IF NOT EXISTS daily_synthesis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number      INTEGER NOT NULL UNIQUE,
  synthesis_text  TEXT NOT NULL,
  entry_count     INTEGER DEFAULT 0,
  generated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Daily wallet decisions — what BLANK did with its treasury
CREATE TABLE IF NOT EXISTS daily_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number      INTEGER NOT NULL UNIQUE,
  decision_text   TEXT NOT NULL,
  wallet_action   TEXT,                -- description of on-chain action
  result          TEXT,                -- outcome after execution
  announced_at    TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entries_status     ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_day        ON journal_entries(day_number);
CREATE INDEX IF NOT EXISTS idx_entries_wallet     ON journal_entries(wallet);
CREATE INDEX IF NOT EXISTS idx_entries_core       ON journal_entries(is_core_memory);
CREATE INDEX IF NOT EXISTS idx_tweets_status      ON scheduled_tweets(status);
CREATE INDEX IF NOT EXISTS idx_waking_day         ON waking_entries(day_number);
CREATE INDEX IF NOT EXISTS idx_synthesis_day      ON daily_synthesis(day_number);
CREATE INDEX IF NOT EXISTS idx_decisions_day      ON daily_decisions(day_number);

-- ─── Row Level Security ───────────────────────────────────
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE waking_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tweets ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_synthesis ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_decisions ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Public read approved entries" ON journal_entries
  FOR SELECT USING (status = 'approved');

CREATE POLICY "Public read waking entries" ON waking_entries
  FOR SELECT USING (status = 'posted');

CREATE POLICY "Public read synthesis" ON daily_synthesis
  FOR SELECT USING (true);

CREATE POLICY "Public read decisions" ON daily_decisions
  FOR SELECT USING (true);

-- Wallet transactions — every on-chain action BLANK has made
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                DATE NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'burn', 'tip', 'hold')),
  asset_name          TEXT,
  asset_mint          TEXT,
  amount_sol          NUMERIC,
  entry_price_usd     NUMERIC,
  exit_price_usd      NUMERIC,
  pnl_sol             NUMERIC,
  pnl_percent         NUMERIC,
  tx_hash             TEXT,
  journal_synthesis   TEXT,
  influencing_entries  TEXT[],
  status              TEXT DEFAULT 'executed' CHECK (status IN ('announced', 'executed', 'failed')),
  announced_at        TIMESTAMPTZ,
  executed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Donations received by the treasury
CREATE TABLE IF NOT EXISTS donations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash     TEXT,
  amount_sol  NUMERIC,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date   ON wallet_transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_action ON wallet_transactions(action);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read transactions" ON wallet_transactions
  FOR SELECT USING (true);

CREATE POLICY "Public read donations" ON donations
  FOR SELECT USING (true);

-- Service role (backend) bypasses RLS — no extra policy needed
-- The SUPABASE_SERVICE_KEY bypasses RLS automatically
