CREATE TABLE `sync_inbox` (
	`op_id` text PRIMARY KEY NOT NULL,
	`ingest_seq` integer NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`user_id` text,
	`authorized_by_user_id` text,
	`created_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`applied_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `ix_inbox_pending` ON `sync_inbox` (`applied_at`,`ingest_seq`);--> statement-breakpoint
CREATE INDEX `ix_inbox_entity` ON `sync_inbox` (`entity`,`entity_id`);