# ADR-0025: Favourites and Best sellers on the Sale screen

**Status:** Accepted · **Date:** 2026-10-19 · **Deciders:** Zothix (Codroon)

## Context

The pilot shop has 557 products and sells the same few dozen all day. The Sale screen showed
every sellable product grouped by category, so the cashier scanned, typed, or scrolled. The
shop asked for the products it sells most to be on the screen.

Mainstream retail POS (Square, Shopify POS, Loyverse, Lightspeed) let the shop pin products
to the sale screen by hand; an automatic best-seller tab is less common. We offer both.

The owner decided: **anybody signed in may pin**, not only owners and managers. The cashier at
the counter knows what they reach for.

## Decision

### 1. Two tabs in front of the groups

**★ Favourites** — products the shop pinned, in the order it arranged them. A star on every
card pins or unpins; on the Favourites tab cards are dragged to reorder.
**Best sellers** — the 20 products sold most over the last 30 days, worked out by itself.

The screen opens on Favourites when anything is pinned, else on Best sellers when anything
has sold, else on All. Typing in the search box always searches the whole catalogue,
whichever tab is open. Scanning is unchanged.

### 2. A pin is its own shared row, not a column on the product

`product_favourites(id = product id, tenant_id, product_id, position, created_at)`, migration
0019, added to `SHARED_ENTITIES` after `product_code`. Both counters show the same tab.

Not a column on `products`, because products resolve concurrent edits by `updated_at` for the
whole row (ADR-0022 §7): a pin stored there would let one till's pin drop the other till's
price change made inside the replication window, or the reverse. A pin and a price must never
meet.

The id is the product's id, so two counters pinning the same product at once write the same
row — one pin, never two, and never a unique-index conflict stuck in an inbox. Unpinning
deletes it. `product_id` is a reference and not a foreign key, so deleting a product never
waits on a pin a sibling has not yet heard is gone; the screen shows only pins whose product
it can sell. Two tills reordering at once can leave two pins on one position; the name breaks
the tie so the tab is stable. Only pins whose position moved are written.

`favourites:toggle` and `favourites:reorder` are registered with `authed()` (a session, no
permission) — the owner's decision, made explicit in the registry rather than by inventing a
permission everybody holds. Every change is a `mutate()` whose oplog entry names who did it.
`sale:quickPicks` reads both tabs behind `sale.create`, like the rest of the Sale screen.

### 3. Best sellers are computed from the shared ledger, never stored

`-sum(qty)` of `sale_out` and `return_in` movements over 30 days, per product, top 20. Stock
movements replicate (ADR-0022), so the list counts every counter's sales, not this one's; a
refund that went back to the shelf takes its unit off again. A stored ranking would be a
second answer to a question the ledger already answers.

Limitation, accepted: a product that does not track stock leaves no movement and so never
appears. Counting receipts instead would see only this till's documents (ADR-0022 §8).

### 4. Found on the way: a deleted product's codes now leave as facts

Deleting a product with no history removed its extra barcodes without oplog entries. On one
till that was invisible; on two, the sibling kept the codes, so the product's own delete failed
its foreign key there on every pass and stayed in the inbox for ever. Each code — and now the
pin — is deleted with its own entry. A test deletes a product with a code and a pin at one
till and asserts the other till holds none of the three and nothing is stuck; it fails on the
old code.

## Consequences

- A till older than v1.5.0 refuses `product_favourite` rows as "not a shared entity" and
  holds them in its inbox until it is upgraded, when they apply. Upgrade a shop's tills
  together.
- `SHARED_ENTITIES` is fourteen entities. ADR-0022 §1's reasoning applies unchanged: a pin is
  the shop's arrangement of the shop's catalogue, and carries nothing that is a till's own.
