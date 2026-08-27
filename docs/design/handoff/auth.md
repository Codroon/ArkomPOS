# Handoff — Auth (Login · Lock · Approval · Usuarios · Owner creation)

Follows [`00-foundations.md`](00-foundations.md): brand tokens only, no raw hex, **one blue
element per surface** (the primary action), **white-on-blue banned**, blue body text on
Bone banned. Spanish only on all four surfaces — these are staff-facing, but the shop is
Spanish and the login screen is the shop's front door, so the ES/EN toggle does not appear
until the shell loads.

Money and time formats unchanged. All strings via `useT()` from the typed dictionary
(ADR-0011).

---

## Shared: the keypad

One component, used by Login, Lock, Approval and Usuarios.

- **10 digit keys + ⌫ + confirm**, 3 columns. Key face 64×56px min — this is used with one
  hand while holding a phone in the other.
- Keys are `card` on `surface`, border `line-strong`, digits Mono 500 at 20px. Pressed
  state `active`. **No key is blue.**
- The PIN display above is **dots, never digits** — 4–6 slots, filled left to right,
  Mono. A shop counter is a public place.
- **Hardware keyboard works everywhere the keypad does**: digits, Backspace, Enter, Esc.
  The physical numpad is faster than tapping and staff will use it.
- Auto-submits at 6 digits only if the user has a 6-digit PIN; otherwise Enter/confirm
  submits. (Length is not revealed before entry — the field simply accepts 4–6.)
- The confirm key is the surface's **one blue element**: `accent` fill, `accent-ink` bold
  label. Disabled until ≥4 digits, where it drops to `surface-2` / `subtle`.

---

## 1. Login

Full-window, replaces the shell. No nav, no topbar chips.

**Layout** — the brand plate from the shell (Graphite 900 bar, ARKOM wordmark, 3px
`accent` underline) across the top, then two columns on `canvas`:

- **Left — who.** `SectionLabel` "¿Quién eres?" then a grid of user tiles, 2 across.
  Each tile: name (13px semibold), role chip below (**Responsable** / **Cajero**, `Chip`
  neutral). Selected tile inverts (`inverse` bg, `inverse-ink`) — graphite, not blue.
  Only `active` users appear. Sorted owners first, then alphabetical.
- **Right — the keypad**, disabled and dimmed until a tile is selected.

**Corner:** bottom-left, 10px `subtle`, Mono — the shop's legal name and `v0.10.0`. This
is how a support call starts ("which version are you on?").

**States**

| State | What shows |
|---|---|
| Idle | No tile selected, keypad dimmed, hint "Selecciona tu usuario" |
| Entering | Dots fill; confirm enables at 4 |
| Wrong PIN | Dots clear, shake, `danger` message: "PIN incorrecto · te quedan {n} intentos" |
| Locked | Tile shows a `warning` chip; keypad disabled; live countdown "Bloqueado · 4:58". Counts down and re-enables itself without a reload |
| No users yet | Cannot happen — owner creation (§5) runs first |

**"He olvidado mi PIN"** — a ghost link under the keypad.
- Cashier selected → plain message: "Pide al responsable que lo restablezca desde Ajustes → Usuarios." No field.
- Owner selected → recovery-code field (Mono, grouped `XXXX-XXXX-XXXX`), then set-new-PIN
  twice, then the new code screen (§5.3).

**Focus:** first tile on mount; after selecting a tile, focus moves to the keypad so the
numpad works immediately.

---

## 2. Lock overlay

Covers **everything**, including modals and drawers. `inverse` at full opacity — the till
should look switched off from across the shop, not merely busy.

- Centred: the Arkom wordmark small, then "Sesión bloqueada", then the **current user's**
  name and role, then the keypad.
- **No user tiles.** Only the locked user can unlock. The way to a different user is
  "Cambiar de usuario" below the keypad, which logs out and returns to Login.
- Text on the graphite ground is `inverse-ink`; the muted line is `inverse-muted`. The
  confirm key stays the one blue.
- **Not dismissible**: Esc does nothing, the overlay traps focus, the window close button
  still works (closing the app is always allowed — it backs up on the way out).
- Wrong PIN and lockout behave exactly as Login, including the countdown.
- **Unlock returns to the exact screen and state that was open**, cart included.

**Trigger:** idle for `auth.idle_lock_minutes` (default 5), or the manual lock button in
the topbar (a small lock glyph beside the user chip).

---

## 3. Approval modal — "Autorización del responsable"

Raised when a cashier attempts an `approvable` action. Modal over `ink/25`, 420px, `card`.

**Header:** title, then the action **in plain Spanish with its details** — this is the
whole point, the owner must know what they are approving without asking:

> **Modificar precio**
> Funda libro Galaxy A16
> 14,90 € → 10,00 €
> Motivo: cliente habitual

Details are per-permission and come from the call site — product name, old → new, reason,
quantity. Never a raw key like `sale.price_override`.

**Body:** owner tile(s). If exactly one owner exists it is **preselected** and the keypad
is immediately live — the common case is one owner and it should be two taps, not four.
Multiple owners render as tiles like Login.

**Footer:** keypad. Confirm = the one blue element, labelled "Autorizar".

**States**

| State | Behaviour |
|---|---|
| Wrong PIN | Same message and remaining-attempts count as Login |
| Owner locked | Keypad disabled, countdown, and — since this blocks the sale — a line offering "Cancelar" prominently |
| Cancel / Esc | Closes, the action does **not** run, and the cancellation is logged |
| Success | Modal closes, the action completes in the same call, brief neutral toast "Autorizado por {nombre}" |

**Never** shows a "remember for 5 minutes" option. Single-use by design (ADR-0012 §5).

---

## 4. Usuarios (nav 12, owner only)

Same two-pane shape as Catálogo: list left, editor right. Hidden entirely from cashiers —
the nav item is not rendered, and the handlers reject the call regardless.

**List** (`DataTable`): Nombre · Rol · Estado · Último acceso.
- Inactive rows render `subtle` with an "INACTIVO" chip; they stay in the list because
  history points at them.
- Header action: **"+ Nuevo usuario"** — `PrimaryButton` graphite, not blue (the editor's
  Guardar is this screen's blue).

**Editor**
- `Nombre` (required), `Rol` (Segmented: Responsable / Cajero).
- **PIN**: on create, two keypad-backed fields, "PIN" and "Repetir PIN", with the weak-PIN
  message inline (`danger-ink`, 11px) — "Evita 1234, 1111 y fechas". On edit, PIN is not
  shown; there is a **"Restablecer PIN"** ghost button instead.
- **Permisos** — override toggles from the registry, `SectionLabel` per `module`
  (Venta · Catálogo · Inventario · Administración). Each row: `labelEs`, a Switch, and a
  small `Chip` reading "Por defecto" / "Permitido" / "Bloqueado" so it is obvious which
  toggles differ from the role.
  - For an **owner** row every toggle is disabled with the hint "El responsable siempre
    tiene todos los permisos."
- `Activo` switch. Deactivating the last active owner is refused with the `LAST_OWNER`
  message, not silently disabled: the user should learn *why*.
- Footer: **Guardar** (`AccentButton`, the one blue) · Cancelar · Restablecer PIN.

**Own-PIN change:** an owner editing themselves and pressing "Restablecer PIN" must enter
the **current** PIN first, in the same modal, above the new one.

---

## 5. Owner creation

Two entry points, one component, and it cannot be skipped.

### 5.1 Fresh install
Appended as a fourth section to the existing first-run dialog, below "Datos iniciales":
`SectionLabel` **"Responsable"** — name, PIN twice. The dialog's single "Empezar" button
now also creates the owner, in the same transaction as the shop.

### 5.2 Existing install (the v0.9.0 upgrade)
Setup is already done but no users exist. On first launch after the update, a
**full-window step** in the same frame as first run, before the till:

> **Un paso más**
> Esta versión añade usuarios y permisos. Crea el responsable de la tienda para continuar.
> Tus ventas, artículos y ajustes siguen intactos.

Then name + PIN twice. The reassurance line matters — the owner is looking at an
unfamiliar screen on a till that worked yesterday.

### 5.3 The recovery code — shown once

Immediately after the owner is created, full-window, and **not dismissible by Esc or a
click outside**:

- `SectionLabel` "Código de recuperación"
- The code, **Mono 700, 22px, grouped**: `K7M4-P2XR-9TQD`, in a `card` box with a
  `warning-bg` band above it reading "Anótalo o imprímelo ahora. No se vuelve a mostrar."
- Two actions: **"Imprimir"** (ghost — sends it to the thermal printer; on failure, the
  usual PDF fallback path) and **"Lo he guardado"** (`AccentButton`, the one blue), which
  is **disabled for 5 seconds** so it cannot be dismissed reflexively.
- Body text, plain: "Sirve para recuperar el acceso si olvidas tu PIN. Guárdalo fuera de
  la caja — en la carpeta de la tienda o en la caja fuerte."

Alphabet excludes `0 O 1 I L` so it can be read off paper without ambiguity.

---

## Shell changes

- **Topbar**, right cluster, before the Till chip: user chip — name (11px) + role chip,
  clicking opens a small menu: *Bloquear* · *Cambiar de usuario* · *Cerrar sesión*.
- **Nav** gains **12 Usuarios**, rendered only when the session holds `users.manage`.
  Locked items keep their LOCK badge as today.
- Cashiers see **11 Ajustes** hidden entirely (it is `settings.edit`), so their nav ends
  at 10.
- Any button whose action the user lacks renders through `<Guarded>`: hidden for
  owner-only keys, and for `approvable` keys **shown normally** — the cashier presses it
  and gets the Approval modal, which is the designed flow, not a dead end.

## Accessibility / focus order

- Login: tiles → keypad → forgot link. Enter submits from anywhere in the keypad.
- Lock: focus trapped in the overlay; Tab cycles keypad → cambiar de usuario.
- Approval: focus opens on the keypad when a single owner is preselected, otherwise on the
  first owner tile. Esc cancels.
- Every keypad key is a real `<button>` with an `aria-label`; the dots have
  `aria-live="polite"` announcing count only, never digits.
