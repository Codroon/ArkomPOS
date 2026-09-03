CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`mtcn` text NOT NULL,
	`sender_name` text NOT NULL,
	`receiver_name` text NOT NULL,
	`country_code` text NOT NULL,
	`principal_cents` integer NOT NULL,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`method` text,
	`shift_id` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`cancel_reason` text,
	`cancel_shift_id` text,
	`cancel_approved_by_user_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_transfer_tenant_mtcn` ON `transfers` (`tenant_id`,`mtcn`);--> statement-breakpoint
CREATE INDEX `ix_transfer_shift` ON `transfers` (`shift_id`);--> statement-breakpoint
CREATE INDEX `ix_transfer_created` ON `transfers` (`tenant_id`,`created_at`);