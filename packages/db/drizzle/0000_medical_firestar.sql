CREATE TABLE `document_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`line_type` text DEFAULT 'product' NOT NULL,
	`product_id` text,
	`unit_id` text,
	`description` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`price_overridden` integer DEFAULT false NOT NULL,
	`override_reason` text,
	`tax_regime` text NOT NULL,
	`tax_rate_bp` integer NOT NULL,
	`base_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_line_doc_no` ON `document_lines` (`document_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `ix_line_product` ON `document_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `document_tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`document_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`card_reference` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_tender_document` ON `document_tenders` (`document_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`doc_type` text DEFAULT 'ticket' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`series_id` text,
	`number` integer,
	`doc_number` text,
	`parked_label` text,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`shift_id` text,
	`user_id` text,
	`fiscal_hash` text,
	`prev_fiscal_hash` text,
	`fiscal_status` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `number_series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_doc_series_number` ON `documents` (`series_id`,`number`);--> statement-breakpoint
CREATE INDEX `ix_doc_status_created` ON `documents` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `number_series` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`prefix` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_series_terminal_doctype` ON `number_series` (`terminal_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `oplog` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_oplog_opid` ON `oplog` (`op_id`);--> statement-breakpoint
CREATE INDEX `ix_oplog_entity` ON `oplog` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `product_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_group_tenant_name` ON `product_groups` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `product_stock` (
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL CHECK (`on_hand` >= 0),
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pk_product_stock` ON `product_stock` (`product_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`barcode` text,
	`group_id` text,
	`item_type` text DEFAULT 'stocked' NOT NULL,
	`cost_cents` integer,
	`price_cents` integer,
	`tax_regime` text,
	`tax_rate_bp` integer,
	`reorder_point` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `product_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_product_tenant_name` ON `products` (`tenant_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_product_tenant_barcode` ON `products` (`tenant_id`,`barcode`);--> statement-breakpoint
CREATE INDEX `ix_product_group` ON `products` (`group_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text,
	`movement_type` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_cost_cents` integer,
	`supplier_id` text,
	`document_id` text,
	`document_line_id` text,
	`reason` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_move_product_created` ON `stock_movements` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_move_document` ON `stock_movements` (`document_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_supplier_tenant_name` ON `suppliers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `sync_cursor` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_acked_seq` integer DEFAULT 0 NOT NULL,
	`last_sync_at` integer
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`product_id` text NOT NULL,
	`imei` text NOT NULL,
	`status` text DEFAULT 'in_stock' NOT NULL,
	`cost_cents` integer NOT NULL,
	`sold_document_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_unit_tenant_imei` ON `units` (`tenant_id`,`imei`);--> statement-breakpoint
CREATE INDEX `ix_unit_product_status` ON `units` (`product_id`,`status`);