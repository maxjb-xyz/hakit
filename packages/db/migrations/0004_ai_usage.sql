CREATE TABLE `ai_usage` (
	`workspace_id` text NOT NULL,
	`day` text NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`workspace_id`, `day`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
