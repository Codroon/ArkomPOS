ALTER TABLE `document_lines` ADD `refunds_line_id` text;--> statement-breakpoint
ALTER TABLE `document_lines` ADD `refunded_qty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `ix_line_refunds` ON `document_lines` (`refunds_line_id`);--> statement-breakpoint
ALTER TABLE `documents` ADD `refunds_document_id` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `refund_reason` text;--> statement-breakpoint
ALTER TABLE `store_credit_vouchers` ADD `refund_document_id` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `verification` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `transfers` ADD `verified_by_user_id` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `transfers` ADD `flag_note` text;