-- ========================================================
-- SMARTCOIN GROUP 4 - SUPABASE DATABASE SCHEMA (IDEMPOTENT)
-- ========================================================

-- 1. Container Table (Holds current live coins inside machine)
CREATE TABLE IF NOT EXISTS public.coin_container (
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
INSERT INTO public.coin_container (id, count_1, count_5, count_10, count_20, total_pesos, last_action)
VALUES (1, 0, 0, 0, 0, 0, 'INITIALIZED')
ON CONFLICT (id) DO NOTHING;


-- 2. Transaction / Event Logs Table (Permanent audit trail)
CREATE TABLE IF NOT EXISTS public.coin_logs (
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


-- 3. Automated Withdraw Commands Table (Direct 0° -> 180° -> 0° Servo Actuation)
DROP TABLE IF EXISTS public.refill_commands CASCADE;

CREATE TABLE IF NOT EXISTS public.withdraw_commands (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    denomination INT NOT NULL CHECK (denomination IN (1, 5, 10, 20)),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Index for ESP32 fast polling of pending withdrawal commands
CREATE INDEX IF NOT EXISTS withdraw_commands_pending_idx
    ON public.withdraw_commands (created_at)
    WHERE status = 'pending';

-- Automatic timestamp trigger function for running & completed states
CREATE OR REPLACE FUNCTION public.handle_withdraw_command_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'running' AND OLD.status != 'running' THEN
        NEW.started_at = timezone('utc'::text, now());
    ELSIF (NEW.status = 'completed' OR NEW.status = 'failed') AND OLD.status NOT IN ('completed', 'failed') THEN
        NEW.completed_at = timezone('utc'::text, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_withdraw_commands_status_timestamps ON public.withdraw_commands;
CREATE TRIGGER trg_withdraw_commands_status_timestamps
    BEFORE UPDATE ON public.withdraw_commands
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_withdraw_command_status_change();


-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.coin_container ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdraw_commands ENABLE ROW LEVEL SECURITY;


-- 5. Safe Policies for coin_container (Drops existing first to prevent Error 42710)
DROP POLICY IF EXISTS "Allow public read on coin_container" ON public.coin_container;
CREATE POLICY "Allow public read on coin_container" 
ON public.coin_container FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow public update on coin_container" ON public.coin_container;
CREATE POLICY "Allow public update on coin_container" 
ON public.coin_container FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public insert on coin_container" ON public.coin_container;
CREATE POLICY "Allow public insert on coin_container" 
ON public.coin_container FOR INSERT TO anon WITH CHECK (true);


-- 6. Safe Policies for coin_logs
DROP POLICY IF EXISTS "Allow public read on coin_logs" ON public.coin_logs;
CREATE POLICY "Allow public read on coin_logs" 
ON public.coin_logs FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow public insert on coin_logs" ON public.coin_logs;
CREATE POLICY "Allow public insert on coin_logs" 
ON public.coin_logs FOR INSERT TO anon WITH CHECK (true);


-- 7. Safe Policies for withdraw_commands
DROP POLICY IF EXISTS "Allow public read on withdraw_commands" ON public.withdraw_commands;
CREATE POLICY "Allow public read on withdraw_commands" 
ON public.withdraw_commands FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow public update on withdraw_commands" ON public.withdraw_commands;
CREATE POLICY "Allow public update on withdraw_commands" 
ON public.withdraw_commands FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public insert on withdraw_commands" ON public.withdraw_commands;
CREATE POLICY "Allow public insert on withdraw_commands" 
ON public.withdraw_commands FOR INSERT TO anon WITH CHECK (true);


-- 8. Safe Realtime Replication (Only adds table if not already added)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'coin_container'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_container;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'coin_logs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_logs;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'withdraw_commands'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.withdraw_commands;
    END IF;
END $$;
