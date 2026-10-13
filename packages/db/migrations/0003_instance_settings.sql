CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_enc` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
