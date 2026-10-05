CREATE TABLE `voucher_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`voucher_id` text NOT NULL,
	`document_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`terminal_id` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voucher_id`) REFERENCES `store_credit_vouchers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_redemption_voucher` ON `voucher_redemptions` (`voucher_id`);--> statement-breakpoint
CREATE INDEX `ix_redemption_when` ON `voucher_redemptions` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_redemption_voucher_doc` ON `voucher_redemptions` (`voucher_id`,`document_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_repair_tickets` (
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
	`deposit_method` text DEFAULT 'cash' NOT NULL,
	`deposit_refunded_cents` integer DEFAULT 0 NOT NULL,
	`deposit_refund_method` text,
	`deposit_refund_shift_id` text,
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
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_repair_tickets`("id", "tenant_id", "location_id", "terminal_id", "document_id", "customer_id", "device_description", "imei", "reported_fault", "condition_at_intake", "damage_screen", "damage_back", "damage_dents", "damage_water", "damage_note", "accessories", "device_passcode", "promised_date", "promised_half", "assigned_user_id", "deposit_cents", "deposit_method", "deposit_refunded_cents", "deposit_refund_method", "deposit_refund_shift_id", "authorized_cap_cents", "diagnosis_fee_cents", "warranty_months", "ready_at", "not_repaired_at", "not_repaired_reason", "collection_document_id", "status", "created_at", "updated_at") SELECT "id", "tenant_id", "location_id", "terminal_id", "document_id", "customer_id", "device_description", "imei", "reported_fault", "condition_at_intake", "damage_screen", "damage_back", "damage_dents", "damage_water", "damage_note", "accessories", "device_passcode", "promised_date", "promised_half", "assigned_user_id", "deposit_cents", "deposit_method", "deposit_refunded_cents", "deposit_refund_method", "deposit_refund_shift_id", "authorized_cap_cents", "diagnosis_fee_cents", "warranty_months", "ready_at", "not_repaired_at", "not_repaired_reason", "collection_document_id", "status", "created_at", "updated_at" FROM `repair_tickets`;--> statement-breakpoint
DROP TABLE `repair_tickets`;--> statement-breakpoint
ALTER TABLE `__new_repair_tickets` RENAME TO `repair_tickets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_repair_document` ON `repair_tickets` (`document_id`);--> statement-breakpoint
CREATE INDEX `ix_repair_status` ON `repair_tickets` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_repair_customer` ON `repair_tickets` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_repair_assigned` ON `repair_tickets` (`assigned_user_id`);--> statement-breakpoint
CREATE TABLE `__new_store_credit_vouchers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`purchase_id` text,
	`refund_document_id` text,
	`amount_cents` integer NOT NULL,
	`remaining_cents` integer NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`redeemed_document_id` text,
	`redeemed_at` integer,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_store_credit_vouchers`("id", "tenant_id", "location_id", "purchase_id", "refund_document_id", "amount_cents", "remaining_cents", "status", "redeemed_document_id", "redeemed_at", "void_reason", "created_at", "updated_at") SELECT "id", "tenant_id", "location_id", "purchase_id", "refund_document_id", "amount_cents", "remaining_cents", "status", "redeemed_document_id", "redeemed_at", "void_reason", "created_at", "updated_at" FROM `store_credit_vouchers`;--> statement-breakpoint
DROP TABLE `store_credit_vouchers`;--> statement-breakpoint
ALTER TABLE `__new_store_credit_vouchers` RENAME TO `store_credit_vouchers`;--> statement-breakpoint
CREATE INDEX `ix_voucher_status` ON `store_credit_vouchers` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_voucher_purchase` ON `store_credit_vouchers` (`purchase_id`);