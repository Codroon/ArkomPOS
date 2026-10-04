-- ADR-0022 §3: an arrival order a till can page a pull against.
--
-- `seq` is per-till and cannot order a stream merged from five tills; a clock
-- ties. So the cloud assigns a number no till can influence. Additive: the
-- rewrite backfills existing rows in physical order, which is the right answer
-- for rows that all predate multi-till, and no reader depends on it yet.

ALTER TABLE "sync_entries" ADD COLUMN "ingest_seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_entries_ingest" ON "sync_entries" USING btree ("tenant_id","ingest_seq");