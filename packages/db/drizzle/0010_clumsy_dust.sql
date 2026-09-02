PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text,
	`permission_overrides` text,
	`active` integer DEFAULT true NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`recovery_code_hash` text,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "tenant_id", "location_id", "terminal_id", "name", "role", "pin_hash", "permission_overrides", "active", "failed_attempts", "locked_until", "recovery_code_hash", "last_login_at", "created_at", "updated_at") SELECT "id", "tenant_id", "location_id", "terminal_id", "name", "role", "pin_hash", "permission_overrides", "active", "failed_attempts", "locked_until", "recovery_code_hash", "last_login_at", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_user_tenant_name` ON `users` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `ix_user_active` ON `users` (`tenant_id`,`active`);