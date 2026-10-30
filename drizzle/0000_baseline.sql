-- Baseline adoption: existing upgraded tables and their data are retained.
CREATE TABLE IF NOT EXISTS `announcement_versions` (
	`announcement_id` text NOT NULL,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`text` text NOT NULL,
	`name` text NOT NULL,
	`contact` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`review` text DEFAULT 'null' NOT NULL,
	`status` text NOT NULL,
	`review_error` text,
	`publication_dates` text DEFAULT '[]' NOT NULL,
	`event_override` text DEFAULT 'null' NOT NULL,
	`event_title` text,
	`event_location` text,
	`event_date` text,
	`event_time` text,
	`event_time_zone` text,
	`event_starts_at_ms` integer,
	PRIMARY KEY(`announcement_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `announcement_versions_request_id_unique` ON `announcement_versions` (`request_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`text` text NOT NULL,
	`name` text NOT NULL,
	`contact` text NOT NULL,
	`original_name` text,
	`original_contact` text,
	`edit_token_hash` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text,
	`review` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_error` text,
	`publication_dates` text DEFAULT '[]' NOT NULL,
	`event_override` text DEFAULT 'null' NOT NULL,
	`event_title` text,
	`event_location` text,
	`event_date` text,
	`event_time` text,
	`event_time_zone` text,
	`event_starts_at_ms` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `announcements_analysis_id_unique` ON `announcements` (`analysis_id`);