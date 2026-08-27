/**
 * Which KDF hashes PINs — and why it is scrypt.
 *
 * ADR-0012 §2 chose argon2id via `@node-rs/argon2`, with `crypto.scrypt` as a
 * documented fallback "if the packaged build has any problem with it". The
 * packaged build had a problem with it.
 *
 * **What happened.** Adding `@node-rs/argon2` to the app's dependencies made
 * electron-builder ship an installer containing exactly one package — argon2
 * itself — and nothing else. No better-sqlite3, no drizzle-orm. The app
 * installed, launched, and died on `Cannot find module 'drizzle-orm/sqlite-core'`.
 * pnpm 10+ does not install transitive platform binaries, so argon2's twelve
 * optional per-platform packages are absent, and electron-builder's node_modules
 * collector truncates the whole tree when it meets them. Removing the dependency
 * restored all 3971 entries. It was found the only way it could be: by
 * installing the thing and watching it fail.
 *
 * **Why this costs nothing.** Hashes are self-describing (`scrypt$…` versus
 * `$argon2id$…`) and `verifyPin` dispatches on the prefix, so this is a runtime
 * choice rather than a migration. And the honest point from the ADR still
 * stands: a six-digit PIN has a million values, so no KDF makes a stolen
 * database safe. The control is the lockout ladder and the shop's front door.
 *
 * **The path back**, if argon2 is ever worth revisiting: add the twelve
 * `@node-rs/argon2-*` platform packages to optionalDependencies (or pin the one
 * for the target platform), then call `setArgon2()` here with the same adapter
 * the tests use. Existing scrypt hashes keep verifying; new ones become
 * argon2id. Nothing else changes.
 */

export function installKdf(): void {
  // scrypt is the default in @arkom/core/pin-hash; nothing to install.
  // Deliberately NOT a lazy `require("@node-rs/argon2")` with a fallback: that
  // would hash with argon2 in dev and scrypt in production, and a dev machine
  // exercising a different code path from the shop's till is the bug this
  // project keeps buying lessons about.
}
