CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`opened_by_user_id` text,
	`opened_at` integer NOT NULL,
	`opening_float_cents` integer DEFAULT 0 NOT NULL,
	`opening_breakdown` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`counted_cash_cents` integer,
	`closing_breakdown` text,
	`expected_cash_cents` integer,
	`variance_cents` integer,
	`variance_reason` text,
	`approved_by_user_id` text,
	`z_series_id` text,
	`z_number` integer,
	`z_doc_number` text,
	`snapshot` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`z_series_id`) REFERENCES `number_series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_shift_terminal_opened` ON `shifts` (`terminal_id`,`opened_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_shift_z_number` ON `shifts` (`z_series_id`,`z_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_shift_open_per_terminal` ON `shifts` (`terminal_id`) WHERE "shifts"."closed_at" is null;--> statement-breakpoint
ALTER TABLE `cash_movements` ADD `concept` text;--> statement-breakpoint
ALTER TABLE `cash_movements` ADD `shift_id` text;--> statement-breakpoint
CREATE INDEX `ix_cash_movement_shift` ON `cash_movements` (`shift_id`);--> statement-breakpoint
ALTER TABLE `repair_tickets` ADD `deposit_method` text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE `repair_tickets` ADD `deposit_refunded_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `repair_tickets` ADD `deposit_refund_method` text;--> statement-breakpoint
ALTER TABLE `repair_tickets` ADD `deposit_refund_shift_id` text;