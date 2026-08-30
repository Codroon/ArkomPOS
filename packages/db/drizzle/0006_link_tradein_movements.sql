-- Point existing trade-in movements at the purchase document that caused them.
--
-- A `sale_out` has always carried the ticket that took the phone off the shelf,
-- so the movements drawer in Inventario shows a link. The `tradein_in` written
-- when a device was bought carried nothing, and the same drawer showed "—":
-- from the ledger there was no way back to the paperwork the seller signed.
--
-- New movements set it at insert time. This fixes the ones already written, on
-- tills that have been buying devices since v0.11.0. It touches only rows that
-- have no document yet, so running it twice changes nothing.
UPDATE stock_movements
SET document_id = (
  SELECT up.document_id
  FROM used_purchases up
  WHERE up.unit_id = stock_movements.unit_id
)
WHERE movement_type = 'tradein_in'
  AND document_id IS NULL
  AND unit_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM used_purchases up WHERE up.unit_id = stock_movements.unit_id);
