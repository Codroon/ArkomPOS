ALTER TABLE `document_lines` ADD `unit_cost_cents` integer;--> statement-breakpoint
CREATE INDEX `ix_line_doc` ON `document_lines` (`document_id`);--> statement-breakpoint
CREATE INDEX `ix_doc_status_completed` ON `documents` (`status`,`completed_at`);