-- Reconstruct the redemption ledger for vouchers that predate it. ADR-0023 §4.
--
-- Hand-written, because this moves DATA rather than schema and drizzle-kit has
-- nothing to diff. It must run exactly once, and it is idempotent anyway: the
-- id it writes is derived from the voucher's, so a second run conflicts with
-- itself and changes nothing.
--
-- Why it is needed, and what goes wrong without it:
--
--   `remaining_cents` stops being the truth in 0016 and becomes a cache of
--   `amount_cents - sum(voucher_redemptions)`. Every voucher spent before this
--   migration has a remainder that was written directly and no ledger row to
--   explain it. Recompute that voucher and the ledger says nothing was ever
--   spent, so the cache is restored to the full face value — the shop hands the
--   credit out a second time, in cash terms, and nothing anywhere says why.
--
--   The pilot has eight vouchers today. One of them being silently refilled is
--   not an acceptable way to find this out.
--
-- Two honest placeholders, both only possible on reconstructed rows:
--
--   `document_id` — the old code recorded the sale ONLY when a voucher was
--   spent to zero (`redeemed_document_id`), so a partly-spent voucher genuinely
--   does not know which sale took the money. It is a plain reference since
--   0016, so a marker is safe and says what it is.
--
--   `terminal_id` — nothing recorded which counter redeemed a voucher before
--   now. A marker rather than a guess; the dashboard's till filter will not
--   claim these for any till, which is correct.

INSERT INTO `voucher_redemptions`
  (`id`, `tenant_id`, `voucher_id`, `document_id`, `amount_cents`, `terminal_id`, `user_id`, `created_at`)
SELECT
  'pre-ledger:' || `id`,
  `tenant_id`,
  `id`,
  COALESCE(`redeemed_document_id`, 'pre-ledger:unknown-document'),
  `amount_cents` - `remaining_cents`,
  'pre-ledger:unknown-till',
  NULL,
  COALESCE(`redeemed_at`, `updated_at`, `created_at`)
FROM `store_credit_vouchers`
WHERE `amount_cents` > `remaining_cents`
  AND `id` NOT IN (SELECT `voucher_id` FROM `voucher_redemptions`);
