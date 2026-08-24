CREATE TABLE `product_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_product_code_product_code` ON `product_codes` (`tenant_id`,`product_id`,`code`);--> statement-breakpoint
CREATE INDEX `ix_product_code_tenant_code` ON `product_codes` (`tenant_id`,`code`);--> statement-breakpoint
DROP INDEX `ux_product_tenant_barcode`;--> statement-breakpoint
CREATE INDEX `ix_product_tenant_barcode` ON `products` (`tenant_id`,`barcode`);