-- LINE Messaging API inbound queue + analyze snapshot (written by Next.js service role).
-- Apply via Supabase SQL Editor or `supabase db push` when linked.

CREATE TABLE IF NOT EXISTS public.line_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_message_id text NOT NULL UNIQUE,
  destination text,
  source_type text NOT NULL CHECK (source_type IN ('group', 'user', 'room')),
  group_id text,
  user_id text,
  raw_text text NOT NULL,
  reply_token text,
  received_at timestamptz NOT NULL DEFAULT now(),
  analyze_status text NOT NULL DEFAULT 'pending' CHECK (analyze_status IN ('pending', 'ok', 'error')),
  analyze_error text,
  analyze_payload jsonb,
  needs_human_review boolean,
  workflow_status text NOT NULL DEFAULT 'pending' CHECK (workflow_status IN ('pending', 'confirmed', 'skipped')),
  car_row_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_inbox_messages_received ON public.line_inbox_messages (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_inbox_messages_workflow ON public.line_inbox_messages (workflow_status);

COMMENT ON TABLE public.line_inbox_messages IS 'LINE webhook messages; analyze_payload holds LineInboxAnalyzeResponse JSON';
