CREATE TABLE `activity_events` (
	`id` text NOT NULL,
	`ts` integer NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`actor_user_id` text,
	`actor_raw` text,
	`repo_id` integer,
	`ref` text,
	`sha` text,
	`pr_number` integer,
	`task_id` text,
	`link_kind` text DEFAULT 'none' NOT NULL,
	`link_confidence` real,
	`title` text NOT NULL,
	`url` text,
	`additions` integer,
	`deletions` integer,
	`files_changed` integer,
	`agent_session_id` text,
	`payload` text,
	PRIMARY KEY(`id`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `activity_project_ts` ON `activity_events` (`project_id`,`ts`);--> statement-breakpoint
CREATE INDEX `activity_task_ts` ON `activity_events` (`task_id`,`ts`);--> statement-breakpoint
CREATE INDEX `activity_actor_ts` ON `activity_events` (`actor_user_id`,`ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_events_commit_dedupe` ON `activity_events` (`project_id`,`sha`,`kind`,`ts`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`external_session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`agent` text NOT NULL,
	`repo_full_name` text,
	`branch` text,
	`cwd_hash` text,
	`status` text DEFAULT 'active' NOT NULL,
	`task_id` text,
	`link_kind` text DEFAULT 'none' NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_event_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`ended_at` integer,
	`summary` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sessions_user_external` ON `agent_sessions` (`user_id`,`external_session_id`);--> statement-breakpoint
CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`share_prompts` integer DEFAULT false NOT NULL,
	`share_paths` integer DEFAULT true NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_token_hash_unique` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`source` text NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`score` real NOT NULL,
	`breakdown` text NOT NULL,
	`reason_codes` text DEFAULT '[]' NOT NULL,
	`explanation` text NOT NULL,
	`explanation_source` text DEFAULT 'template' NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assignments_task` ON `assignments` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_one_active_per_task` ON `assignments` (`task_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `author_aliases` (
	`email_or_login` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`hackathon_template_id` text NOT NULL,
	`key` text NOT NULL,
	`sponsor` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`requirements` text DEFAULT '[]' NOT NULL,
	`required_tech` text DEFAULT '[]' NOT NULL,
	`prize` text,
	`url` text,
	`verified` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`hackathon_template_id`) REFERENCES `hackathon_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `challenges_template_key` ON `challenges` (`hackathon_template_id`,`key`);--> statement-breakpoint
CREATE TABLE `embedding_cache` (
	`hash` text NOT NULL,
	`model` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`hash`, `model`)
);
--> statement-breakpoint
CREATE TABLE `github_installations` (
	`id` integer PRIMARY KEY NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text NOT NULL,
	`suspended_at` integer,
	`created_by_user_id` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `github_tokens` (
	`user_id` text PRIMARY KEY NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`access_expires_at` integer,
	`refresh_expires_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `hackathon_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`timezone` text NOT NULL,
	`tracks` text DEFAULT '[]' NOT NULL,
	`judging_criteria` text DEFAULT '[]' NOT NULL,
	`source_url` text,
	`verified_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hackathon_templates_slug_unique` ON `hackathon_templates` (`slug`);--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`pitch` text NOT NULL,
	`payload` text NOT NULL,
	`team_fit` real DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`code` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_code_unique` ON `invites` (`code`);--> statement-breakpoint
CREATE TABLE `member_embeddings` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`embedding` text NOT NULL,
	`model` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member_profiles` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`headline` text,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`interests` text DEFAULT '[]' NOT NULL,
	`learning_goals` text DEFAULT '[]' NOT NULL,
	`avoid` text DEFAULT '[]' NOT NULL,
	`availability` text DEFAULT '[]' NOT NULL,
	`available_hours` real DEFAULT 0 NOT NULL,
	`onboarding_completed_at` integer,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`level` integer NOT NULL,
	`confidence` real NOT NULL,
	`source` text NOT NULL,
	`confirmed_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_skills_user_skill` ON `member_skills` (`user_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`color_index` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`plan_id` text,
	`title` text NOT NULL,
	`ordinal` integer NOT NULL,
	`target_at` integer,
	`description` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`payload` text NOT NULL,
	`feasibility` text NOT NULL,
	`model` text NOT NULL,
	`prompt_hash` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_project_version` ON `plans` (`project_id`,`version`);--> statement-breakpoint
CREATE INDEX `plans_prompt_hash` ON `plans` (`prompt_hash`);--> statement-breakpoint
CREATE TABLE `project_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`value` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_repos` (
	`project_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`connected_by` text,
	`connected_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `repo_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_repos_repo` ON `project_repos` (`repo_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`pitch` text,
	`status` text DEFAULT 'ideating' NOT NULL,
	`repo_id` integer,
	`current_plan_id` text,
	`next_task_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`severity` text NOT NULL,
	`headline` text NOT NULL,
	`rationale` text NOT NULL,
	`impact` text DEFAULT '{}' NOT NULL,
	`actions` text NOT NULL,
	`signals` text DEFAULT '[]' NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`dismiss_reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendations_open_dedupe` ON `recommendations` (`project_id`,`dedupe_key`) WHERE status = 'open';--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY NOT NULL,
	`installation_id` integer,
	`full_name` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`html_url` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`pushed_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `github_installations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `skill_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`url` text,
	`weight` real NOT NULL,
	`summary` text NOT NULL,
	`detail` text,
	`observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_evidence_user` ON `skill_evidence` (`user_id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`related` text DEFAULT '[]' NOT NULL,
	`pending_review` integer DEFAULT false NOT NULL,
	`embedding` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_slug_unique` ON `skills` (`slug`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`kind` text DEFAULT 'blocks' NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`actor_user_id` text,
	`kind` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_events_task` ON `task_events` (`task_id`,`at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`milestone_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'should' NOT NULL,
	`estimate_hours` real DEFAULT 2 NOT NULL,
	`required_skills` text DEFAULT '[]' NOT NULL,
	`embedding` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_number` ON `tasks` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `tasks_project_status` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_user_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`email` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_user_id_unique` ON `users` (`github_user_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`action` text,
	`installation_id` integer,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`hackathon_template_id` text,
	`starts_at` integer,
	`deadline_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`hackathon_template_id`) REFERENCES `hackathon_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);