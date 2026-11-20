# Sahay UI v5 kit (W1 foundation) — the contract every screen builds on

Brief: `docs/superpowers/plans/2026-11-20-ui-v5-brief.md`. Warm black, creamy pink accent, calm and
solid. Owner: W1. Ask W1 (through the coordinator) for a new primitive instead of styling one locally.

## Files
| File | What |
|---|---|
| `css/tokens.css` | every colour, type, space, radius, motion, layer token |
| `css/components.css` | base reset + every component class below + the toast (sileo) theme |
| `css/app.css` | the app shell: top bar, phone tab bar, layout, banners (W1) |
| `js/app/ui.js` | the kit: import everything from here |
| `js/app/keypad.js` | the number keypad (re-exported by ui.js) |
| `js/app/format.js` | money / quantity / item / day words (re-exported by ui.js) |
| `js/app/shell.js` | the shell API (section "Shell") |
Screen CSS: one file per owner (`css/home.css` W2, `css/yes.css` W3, `css/buy.css` + `css/stock.css` W4A,
`css/sell.css` + `css/money.css` W4B, `css/me.css` + `css/auth.css` W5), linked by W1 in app.html after
`app.css`. Tokens only (no raw hex), no glow, no neon, no blur on content, no uppercase in hi / kn.

## Tokens (`tokens.css`)
- Colour: `--bg` #0F0D0E, `--surface` #181416, `--surface-2` #211C1E, `--surface-3`, `--hairline`
  rgba(242,207,198,.14), `--hairline-strong`, `--edge` (control boundary); text `--text` #F8ECE8, `--text-muted`
  #BBA8A4, `--text-faint` (decoration only); accent `--pink` #F2CFC6, `--pink-hover`, `--pink-pressed`,
  `--pink-soft` (tint), `--on-pink` #2A1A1C; status `--good` #9BD3A8, `--warn` #F0C47E, `--needs` #EE8E82,
  `--info` #A9C4E8 (+ `-soft` tints), `--on-status`; `--scrim`, `--dot`.
- Type: `--font` Manrope (everything), `--font-hi` Hind, `--font-kn` Noto Sans Kannada (`:lang()` applies them);
  `--fs-title` 28-40px 700, `--fs-h2` 22px, `--fs-h3` 18px, `--fs-body` 17px / `--lh` 1.6 (`--lh-indic` 1.7),
  `--fs-small` 15px, `--fs-label` 13px 600, `--fs-figure` 32-44px (big amounts, tabular), `--fs-amount` 20px.
- Shape: `--r-sm` 10, `--r` 16 (cards, inputs), `--r-lg` 20 (sheets), `--r-pill`; `--shadow` (the one soft
  shadow), `--shadow-sheet`.
- Space `--s1`..`--s8` (4..64); targets `--tap` 48, `--tap-primary` 56, `--tap-hero` 64; `--content-max` 1120;
  `--gutter` 16/24/32; `--topbar-h` 64; `--tabbar-h` 64; safe areas `--safe-t/r/b/l`.
- Motion `--t-fast` 120, `--t` 200, `--t-slow` 280, `--ease`, `--ease-in`; layers `--z-bar` 40, `--z-banner`,
  `--z-menu` 60, `--z-toast` 65, `--z-sheet` 80; `--focus` ring (pink).

## Classes (`components.css`)
| Component | Markup | Notes |
|---|---|---|
| Button | `.btn` + `.btn-primary` (pink) / `.btn-secondary` (outline) / `.btn-ghost` / `.btn-danger`; `.btn-hero` 64, default 56, `.btn-sm` 48; `.btn-block`; `.is-done` | icon + word; `[aria-busy]` with `.spinner`; `[disabled]` |
| Text link button | `.link-btn` ("Type instead", "Show all") | 48px tall |
| Icon button | `.icon-btn` (48 circle; only close / back / read-aloud / send) | always `aria-label` |
| Yes / No | `.yesno` (two 64px buttons, No outline left, Yes pink right) | `yesNo()` |
| Page head | `header.page-head > .page-head-text > h1.page-title (+ span.accent) + p.page-sentence`, `.page-action` | `pageHead()` |
| Section | `section.section > .section-head > h2.section-title (+ .count) + .section-sub` | `section()` |
| Card | `.card`, `.card-head`, `.card-title`, `.card-sub`, `.card-foot`, `.card-needs`; `button.card` = whole card taps | `card()` |
| Grid | `.grid` (auto-fill 260px) | |
| Tiles | `.tiles > .tile > .tile-label + .tile-value` (Home "Today") | 2 per row phone, 4 laptop |
| Figures | `.figure` (32-44px), `.amount` (20px), `.num` (tabular) | Indian grouping via `rupees()` / `money()` |
| List | `ul.list > li > .row` (`.row-ico`, `.row-main > .row-title + .row-sub`, `.row-end`, `.row-chev`) | `list()`; 72px rows; show 5 then "Show all" |
| Chip / badge | `.chip` + `.chip-good` / `-warn` / `-needs` / `-info`; `.badge` (count) | `chip()`, `simChip()`, `testChip()` |
| Field | `.field > .field-label + .input (+ .field-help / .field-error)`; `.phone-field > .phone-cc + .input` | `field()`, `phoneField()` |
| Segmented | `.seg > button.seg-opt[aria-pressed]` | `segmented()` |
| Toggle | `label.toggle > input[role=switch] + .toggle-track` | `toggle()` |
| Empty | `.empty > .empty-ico + .empty-title + .empty-text + .btn`; `.empty-inline` | `emptyState()` |
| Skeleton | `.skel` + `.skel-line(.short)` / `.skel-row` / `.skel-card` | `skeleton()` |
| Error / note | `p.error-line`, `p.note-line` | `errorLine()` |
| Banner | `.banner` + `.banner-warn` / `.banner-needs`, `.banner-text` | shell offline / live updates |
| Sheet / modal | `.sheet-root > .sheet-scrim + .sheet > .sheet-grip + .sheet-head (.sheet-title) + .sheet-body + .sheet-foot` | `openSheet()`; bottom sheet < 768px, centred modal from 768px |
| Menu | `.menu > button.menu-item (+ .menu-check)`, `.menu-sep` | `openMenu()` |
| Language | `button.lang-switch > svg + .lang-switch-name + .lang-switch-caret` | `langSwitch()` |
| Brand | `a.brand > img + .brand-word` | `brandMark()` |
| Keypad | `.pad`, `.pad-cells`, `.pad-cell(.is-on)`, `.pad-text`, `.pad-keys`, `.pad-key(-del/-done)`, `.pad-msg` | `createKeypad()` |
| Read aloud | `.speak-wrap > button.speak[data-state] + .speak-note` | `speakButton(key)` from speak.js |
| Tooltip | `[data-tip="word"]` (icon-only buttons) | |
| Toasts | sileo restyled (`.toast-host` …) | `notify()` from ui.js |

## JS kit (`js/app/ui.js`)
```js
import { h, icon, scripted, fill, patch, rupees, money, qtyText, itemName, daysWord, initialsOf,
  button, pageHead, section, card, list, chip, simChip, testChip, emptyState, skeleton, errorLine,
  field, phoneField, segmented, toggle, yesNo, openSheet, closeSheet, openMenu, closeMenu,
  langSwitch, uiLang, setUiLang, brandMark, notify, dismiss, createKeypad } from "./ui.js";
```
- `button({ word, icon, kind: "primary"|"secondary"|"ghost"|"danger", size: "hero"|"md"|"sm", onClick, href, label, busy, block })`
- `pageHead({ title, accent, sentence, action: {word, icon, onClick} | Node })` — every screen: title + one
  plain sentence + ONE primary action.
- `section({ title, count, sub, action, body, id })`; `card({ title, sub, body, foot, onClick, needs, speakKey })`
- `list(rows, { limit = 5, label })` with rows `{ icon, title, sub, end, onClick | href, label }`
- `emptyState({ icon, title, text, action, inline })`; `skeleton("rows"|"cards"|"lines", n)`; `errorLine(text)`
- `yesNo({ onYes, onNo, busy: "yes"|"no"|null, yesWord, noWord, yesLabel, noLabel })`
- `openSheet({ title, body, footer, opener, label, onClose, speakKey })` -> `{ el, setBody, setFooter, setBusy, close, isOpen }`
- `openMenu({ anchor, label, items: [{ id, label, icon, lang, current, sep }], onPick })`
- `langSwitch()` -> `{ el, update }`; `uiLang()` ("en" default, localStorage `sahay-ui-lang`); `setUiLang(code)`
  (also fires `sahay:ui-lang`; the shell turns it into a store "lang" refresh so every screen re-renders).
- `brandMark({ word = true, size = 36, href = "#/home" })` — the real logo (`/assets/brand/sahay-mark-128.png`).
- `createKeypad({ length, mask, label, onDone, format, doneWord, autoAdvance })` -> `{ el, value, clear, setBusy, focus, shake, setError, setLocked }`
- Icons: `icon(name, size)` 24-grid, 1.5px stroke (names: `ICON_NAMES` in dom.js). Always icon + word.

## Shell (`js/app/shell.js`) — routes and mount points
Routes: `#/home` (default; `#/sahay`, `#/talk` and empty are aliases), `#/buy` (`#/work`, `#/orders`), `#/sell`,
`#/stock`, `#/money`, `#/me` and `#/me/<section>` (`#/history` -> `#/me/history`), `#/needs` (opens the Yes host
where the owner is; `#/waiting` alias), `#/signup`, `#/login`.
A screen is `{ el, update(state, parts), enter?({ sub }), leave?() }`, registered in `js/app/screens.js`
(each owner edits only its own line).
```js
import { slots, setNeedsCount, onNeeds, setTitle, navigate } from "./shell.js";
slots = { main, needsHost, toastRegion, bannerSlot }   // needsHost: where W3 mounts the Yes sheet / modal layer
setNeedsCount(n)   // the "Needs you (n)" button in the top bar and the dot on Home; 0 hides it
onNeeds(fn)        // fn() when the owner taps "Needs you" (W3 opens its Yes host); also event "sahay:open-needs"
setTitle(text)     // document.title "Text · Sahay"
```
Document events: `sahay:talk` `{ mode, hint }` (start a call in place), `sahay:open-needs`, `sahay:ui-lang`.
