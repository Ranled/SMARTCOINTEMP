-- ========================================================
-- SMARTCOIN GROUP 4 - SUPABASE DATABASE SCHEMA
-- ========================================================

-- 1. Container Table (Holds current live coins inside machine)
CREATE TABLE IF NOT EXISTS coin_container (
    id INT PRIMARY KEY DEFAULT 1,
    count_1 INT NOT NULL DEFAULT 0,
    count_5 INT NOT NULL DEFAULT 0,
    count_10 INT NOT NULL DEFAULT 0,
    count_20 INT NOT NULL DEFAULT 0,
    total_pesos INT NOT NULL DEFAULT 0,
    last_action VARCHAR(50) DEFAULT 'INITIALIZED',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Insert the default container row if not exists
INSERT INTO coin_container (id, count_1, count_5, count_10, count_20, total_pesos, last_action)
VALUES (1, 0, 0, 0, 0, 0, 'INITIALIZED')
ON CONFLICT (id) DO NOTHING;


-- 2. Transaction / Event Logs Table (Permanent audit trail)
CREATE TABLE IF NOT EXISTS coin_logs (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(20) NOT NULL, -- 'DEPOSIT' or 'WITHDRAWAL'
    denomination INT DEFAULT 0,      -- 1, 5, 10, 20 or 0 for total withdrawal
    amount INT NOT NULL,             -- value added or withdrawn
    count_1 INT NOT NULL DEFAULT 0,  -- snapshot of 1 peso coins at event time
    count_5 INT NOT NULL DEFAULT 0,  -- snapshot of 5 peso coins at event time
    count_10 INT NOT NULL DEFAULT 0, -- snapshot of 10 peso coins at event time
    count_20 INT NOT NULL DEFAULT 0, -- snapshot of 20 peso coins at event time
    total_pesos INT NOT NULL DEFAULT 0, -- total at event time
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Enable Row Level Security (RLS) & Allow Anonymous Access
ALTER TABLE coin_container ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on coin_container" 
ON coin_container FOR SELECT TO anon USING (true);

CREATE POLICY "Allow public update on coin_container" 
ON coin_container FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow public insert on coin_container" 
ON coin_container FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow public read on coin_logs" 
ON coin_logs FOR SELECT TO anon USING (true);

CREATE POLICY "Allow public insert on coin_logs" 
ON coin_logs FOR INSERT TO anon WITH CHECK (true);

-- 4. Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE coin_container;
ALTER PUBLICATION supabase_realtime ADD TABLE coin_logs;
