ALTER TABLE `product_groups` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `is_demo` integer DEFAULT false NOT NULL;