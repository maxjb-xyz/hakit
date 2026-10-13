-- 15-minute activity rollup for health, stall detection and Mission Control sparklines.
-- Was a TimescaleDB continuous aggregate on Postgres; a plain view over the (project_id, ts) index is
-- fast enough at hackathon scale. `bucket` is epoch milliseconds, like every timestamp column.
CREATE VIEW `activity_hourly` AS
SELECT
  (`ts` / 900000) * 900000 AS `bucket`,
  `project_id`,
  `actor_user_id`,
  `task_id`,
  `source`,
  `kind`,
  count(*) AS `n`,
  coalesce(sum(`additions`), 0) AS `adds`,
  coalesce(sum(`deletions`), 0) AS `dels`
FROM `activity_events`
GROUP BY 1, 2, 3, 4, 5, 6;
