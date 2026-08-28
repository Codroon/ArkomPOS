CREATE TABLE `purchase_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `used_purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_photo_purchase` ON `purchase_photos` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `store_credit_vouchers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`purchase_id` text,
	`amount_cents` integer NOT NULL,
	`remaining_cents` integer NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`redeemed_document_id` text,
	`redeemed_at` integer,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `used_purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_voucher_status` ON `store_credit_vouchers` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_voucher_purchase` ON `store_credit_vouchers` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `used_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`document_id` text NOT NULL,
	`unit_id` text,
	`product_id` text,
	`brand` text NOT NULL,
	`model` text NOT NULL,
	`storage` text,
	`color` text,
	`grade` text NOT NULL,
	`battery_pct` integer,
	`imei` text NOT NULL,
	`accessories` text,
	`barcode` text,
	`seller_name` text NOT NULL,
	`seller_phone` text,
	`seller_id_type` text NOT NULL,
	`seller_id_number` text NOT NULL,
	`seller_address` text,
	`acquisition_channel` text DEFAULT 'private_individual' NOT NULL,
	`buy_price_cents` integer NOT NULL,
	`refurb_cost_cents` integer DEFAULT 0 NOT NULL,
	`payout_method` text NOT NULL,
	`payout_reference` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`purchased_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_purchase_document` ON `used_purchases` (`document_id`);--> statement-breakpoint
CREATE INDEX `ix_purchase_imei` ON `used_purchases` (`tenant_id`,`imei`);--> statement-breakpoint
CREATE INDEX `ix_purchase_unit` ON `used_purchases` (`unit_id`);--> statement-breakpoint
ALTER TABLE `units` ADD `purchase_id` text;--> statement-breakpoint
ALTER TABLE `units` ADD `sale_price_cents` integer;--> statement-breakpoint
ALTER TABLE `units` ADD `grade` text;--> statement-breakpoint
ALTER TABLE `units` ADD `battery_pct` integer;