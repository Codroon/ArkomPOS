CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`document_id` text,
	`ticket_id` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_cash_movement_created` ON `cash_movements` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_cash_movement_document` ON `cash_movements` (`document_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_normalized` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_customer_tenant_phone` ON `customers` (`tenant_id`,`phone_normalized`);--> statement-breakpoint
CREATE INDEX `ix_customer_name` ON `customers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `repair_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`method` text NOT NULL,
	`approved_total_cents` integer NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_repair_approval_ticket` ON `repair_approvals` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `repair_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`kind` text NOT NULL,
	`product_id` text,
	`description` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`unit_cost_cents` integer,
	`charge_cents` integer DEFAULT 0 NOT NULL,
	`supplier_text` text,
	`expected_cost_cents` integer,
	`ordered_at` integer,
	`received_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_repair_line_ticket` ON `repair_lines` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `repair_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_repair_notify_ticket` ON `repair_notifications` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `repair_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_repair_photo_ticket` ON `repair_photos` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `repair_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`document_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`device_description` text NOT NULL,
	`imei` text,
	`reported_fault` text NOT NULL,
	`condition_at_intake` text,
	`damage_screen` integer DEFAULT false NOT NULL,
	`damage_back` integer DEFAULT false NOT NULL,
	`damage_dents` integer DEFAULT false NOT NULL,
	`damage_water` integer DEFAULT false NOT NULL,
	`damage_note` text,
	`accessories` text,
	`device_passcode` text,
	`promised_date` integer,
	`promised_half` text,
	`assigned_user_id` text,
	`deposit_cents` integer DEFAULT 0 NOT NULL,
	`authorized_cap_cents` integer,
	`diagnosis_fee_cents` integer DEFAULT 0 NOT NULL,
	`warranty_months` integer DEFAULT 3 NOT NULL,
	`ready_at` integer,
	`not_repaired_at` integer,
	`not_repaired_reason` text,
	`collection_document_id` text,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_repair_document` ON `repair_tickets` (`document_id`);--> statement-breakpoint
CREATE INDEX `ix_repair_status` ON `repair_tickets` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_repair_customer` ON `repair_tickets` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_repair_assigned` ON `repair_tickets` (`assigned_user_id`);