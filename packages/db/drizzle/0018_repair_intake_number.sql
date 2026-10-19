-- The R- number travels with the repair ticket. ADR-0024 §5.
--
-- A repair taken in at one till could not be found at the shop's other till:
-- every repair screen joined the R- custody document to show its number, and
-- that document stays on the till that printed it (ADR-0023 §2). The ticket
-- arrived; the screens could not see it.
ALTER TABLE `repair_tickets` ADD `intake_doc_number` text;
--> statement-breakpoint
-- Every ticket this till took in already has its receipt here: copy the number
-- across. A sibling's ticket has no receipt here and stays NULL until its own
-- till sends the number.
UPDATE `repair_tickets` SET `intake_doc_number` = (
  SELECT `doc_number` FROM `documents` WHERE `documents`.`id` = `repair_tickets`.`document_id`
) WHERE `intake_doc_number` IS NULL;
