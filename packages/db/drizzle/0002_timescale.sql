-- TimescaleDB + pgvector objects Drizzle cannot express (docs/ARCHITECTURE.md §5.5, §5.7).

-- activity_events → hypertable, 1-day chunks.
SELECT create_hypertable('activity_events', by_range('ts', INTERVAL '1 day'), if_not_exists => TRUE);
--> statement-breakpoint

-- 15-minute activity rollup powering health, stall detection, and Mission Control sparklines.
-- WITH NO DATA so it can be created inside the migration transaction; the policy backfills.
CREATE MATERIALIZED VIEW IF NOT EXISTS activity_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '15 minutes', ts) AS bucket,
  project_id,
  actor_user_id,
  task_id,
  source,
  kind,
  count(*) AS n,
  coalesce(sum(additions), 0) AS adds,
  coalesce(sum(deletions), 0) AS dels
FROM activity_events
GROUP BY 1, 2, 3, 4, 5, 6
WITH NO DATA;
--> statement-breakpoint
SELECT add_continuous_aggregate_policy('activity_hourly',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '2 minutes',
  if_not_exists => TRUE);
--> statement-breakpoint

-- Vector indexes (cosine). Tiny row counts; HNSW defaults are fine.
CREATE INDEX IF NOT EXISTS skills_embedding_hnsw ON skills USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_embedding_hnsw ON tasks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS member_embeddings_hnsw ON member_embeddings USING hnsw (embedding vector_cosine_ops);
