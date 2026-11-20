# Sahay UI v5 kit (W1 foundation) — the contract every screen builds on

Binding spec: `docs/build/evidence/ux-v5/screens.md` (+ `refs.md`). Brief: `docs/superpowers/plans/2026-11-20-ui-v5-brief.md`.
Warm black, creamy pink accent, calm and solid. Owner: W1. Ask W1 (through the coordinator) for a new
primitive instead of styling one locally. Sentence case only: no all caps, no letter-spaced eyebrows,
no "A · B · C" meta strings.

## v7 look (brief `docs/superpowers/plans/2026-11-20-ui-v7-brief.md`: yugaantar.org, Sahay-themed) — current
The NAMES below (tokens, classes, JS exports) are unchanged from v5; only their look changed, so every screen
restyles by itself. Where the v5 notes further down describe colours, radii or button shapes, this section wins.
- Colours: page navy `--navy` #0B1F4B (`--bg`), `--deep` #061431 (bars, inputs, hard shadows), cards `--card` #112A60
  (`--surface`) / `--card-2` #0F2753 (`--surface-2`), pixel border `--border` #2B4C8A (`--line`), `--line-strong` #4A6DAE,
  cream text `--cream` #F3F1E2 (`--text`), `--muted` #A7B6D6, accent LIME `--lime` #A8E27C (`--accent`; the v5 slot
  `--pink` now holds lime and `--on-pink` navy), paper panels `--paper` #F3F1E2 with `--paper-ink` #0F2753, `--sky`
  #133D7E (hover), `--blue` #1C61A1, `--moon`, `--gold`; status `--good` #A8E27C, `--warn` #F0C47E, `--needs` #F2877A,
  `--info` #8EC5F0; `--scrim` #03091AED.
- Shape: radius 0 everywhere (`--r-*` are all 0). Pixel edge `--pixel-edge` (0 0 0 2px border); buttons
  `--shadow-btn` (pixel edge + 2px 2px 0 deep), cards `--shadow` (4px 4px 0 deep), sheets `--shadow-sheet`. No blur,
  no glow, no gradients except the page's star field / dot grid.
- Type: titles and big numbers Jersey 10 (`--font-display`, weight 400, tracking `--display-track` .02em); body Amarna
  (`--font`, 17px/1.55); HUD labels Amarna 600 13px UPPERCASE .14em (`font: var(--t-label)` +
  `text-transform: var(--hud-case); letter-spacing: var(--hud-track)`, or class `.hud`). Hindi: Jaini Purva display +
  Hind body; Kannada: Baloo Tamma 2 display + Noto Sans Kannada body; on those pages `--hud-case` is none and the
  tracking tokens are 0. Sizes: `--fs-display` 56 (phone 40), `--fs-amount-xl` 56, `--fs-title` 30 (phone 26),
  `--fs-amount` 24 (Jersey), `--fs-body` 17, `--fs-label` 13, `--fs-meta` 15.
- Buttons: square, 48px (`.btn-lg` 56, `.btn-sm` 44 + 48 tap area), HUD caps. `.btn-primary` = lime fill, navy text,
  pixel edge + hard shadow; hover lifts 1px, press drops 2px. `.btn-secondary` = translucent navy + 1.6px cream border
  + an automatic "→" (not on the No of `yesNo()`; add `.btn-noarrow` to drop it). `.btn-danger` = needs-red border.
- Cards, lists, tiles, inputs, tabs, toggles, sheets, menus, toasts: square, 2px pixel border, hard shadow. A cream
  paper panel: add `.card-paper` (or `.paper-panel`) to a card or list — it re-points `--text`/`--muted`/`--line`
  inside so the same components read navy on cream.
- Shell: 66px night bar (56 phone) — logo + "Sahay" (Jersey, lime) | HOME · BUY · SELL · STOCK · MONEY in HUD caps,
  active = lime text + 2px lime underline | language, NEEDS YOU (n), account (square initials). Phone: 64px deep tab
  bar, icon over a HUD word, active = lime with a lime bar on top. Background: navy with a faint star field and dot grid.
- Fonts in app.html: Jersey 10, Amarna 400-700, Jaini Purva, Hind, Baloo Tamma 2, Noto Sans Kannada (Google Fonts).

## Files
| File | What |
|---|---|
| `css/tokens.css` | every colour, type, space, radius, motion, layer token |
| `css/components.css` | base reset + every component class below + the toast (sileo) theme |
| `css/app.css` | the app shell: top bar, phone tab bar, layout, banners (W1) |
| `js/app/ui.js` | the kit: import everything from here |
| `js/app/icons.js` | Tabler Icons outline paths (MIT), only the ones used; drawn at stroke 1.5 by `icon()` |
| `js/app/keypad.js`, `js/app/format.js` | keypad; money / quantity / item / day words (both re-exported by ui.js) |
| `js/app/shell.js`, `js/app/routes.js`, `js/app/screens.js` | the shell API, routes, route -> screen factory |
Screen CSS (one per owner, linked by W1 in app.html after `app.css`): `home.css` (W2), `yes.css` (W3),
`buy.css` + `stock.css` (W4A), `sell.css` + `money.css` (W4B), `me.css` + `auth.css` (W5). Tokens only (no raw
hex), no gradients, no glow, no `backdrop-filter`, no coloured shadows, no uppercase in hi / kn.

## Tokens (`tokens.css`, spec section 1)
- Colour: `--bg` #0F0D0E, `--surface` #181416, `--surface-2` #211C1E, `--line` rgba(242,207,198,.14), `--line-strong`
  rgba(242,207,198,.32), `--text` #F8ECE8, `--muted` #BBA8A4, `--pink` #F2CFC6, `--pink-hover` #F7DDD6, `--pink-press`
  #E6B9AE, `--on-pink` #2A1A1C, `--good` #9BD3A8, `--warn` #F0C47E, `--needs` #EE8E82, `--info` #A9C4E8, `--scrim`, `--dot`,
  `--disabled`, `--toggle-off`. Status colours only as an 8px dot or a 2px left rule next to the word.
- Type roles as `font` shorthands (Hindi / Kannada pages get Hind / Noto Sans Kannada automatically):
  `font: var(--t-display)` 40/48 700 (phone 30/36), `--t-amount-xl` 44/52 (phone 40/48), `--t-title` 22/30 700,
  `--t-body` 17/27 500, `--t-amount` 20/28 700, `--t-label` 14/20 600, `--t-meta` 13/18 600. Sizes alone:
  `--fs-display`, `--fs-amount-xl`, `--fs-title`, `--fs-body`, `--fs-amount`, `--fs-label`, `--fs-meta`.
  Money always `font-variant-numeric: tabular-nums` (classes `.amount`, `.amount-xl`, `.num` do it).
- Space `--s1`..`--s8` (4..64), `--card-pad` 24 (phone 16), `--group-gap` 32 (phone 24), `--gutter` 32 (phone 16),
  `--content-max` 1120. Radius `--r-card` 18, `--r-sheet` 24, `--r-input` 14, `--r-tile` 14, `--r-pill`. One shadow
  `--shadow`. Buttons `--btn` 52, `--btn-lg` 60, `--btn-sm` 44 (+48px tap area), `--tap` 48. Bars `--topbar-h` 64
  (phone 56), `--tabbar-h` 64.
- Focus: `outline: 2px solid var(--pink-hover); outline-offset: 3px` (global). Motion 120 / 200 / 320ms, ease
  `cubic-bezier(.3,.7,.4,1)`; only transform and opacity animate; reduced motion = instant.
- Names from the first v5 kit still work (same values): `--hairline`, `--hairline-strong`, `--edge`, `--text-muted`,
  `--text-faint`, `--surface-3`, `--pink-pressed`, `--pink-soft`, `--*-soft`, `--fs-h2`, `--fs-h3`, `--fs-small`,
  `--fs-figure`, `--r`, `--r-lg`, `--r-sm`, `--tap-primary`, `--tap-hero`. Note: `--fs-title` is now the 22px card
  title; page titles use `font: var(--t-display)` (class `.page-title`).

## Classes (`components.css`, spec section 2)
| Component | Markup | Notes |
|---|---|---|
| Button | `.btn` + `.btn-primary` (solid pink, dark text) / `.btn-secondary` (1px cream outline) / `.btn-ghost` / `.btn-danger` (`.btn-fill` for a filled red); sizes `.btn-lg` 60, `.btn-md` 52, `.btn-sm` 44 (+48 tap area); `.btn-block`; `.is-done` | FLAT solid pills (owner's choice): no edge, no shadow, no travel; hover a slightly darker pink. Icon + word. `[aria-busy]` shows `.dots`; `[disabled]` grey. Old `.btn-edge` / `.btn-front` markup is harmless |
| Text link | `.link-btn` ("Type instead", "Show all"), underline on hover | 48px tall |
| Icon button | `.icon-btn` (40 visual, 48 tap area: close / back / read-aloud / send only) | always `aria-label` |
| Loader | `.dots > span*3` (uiverse adamgiebl_thin-lionfish-5, MIT), `.loading-line` | always beside a word: `loader(word)` |
| Yes / No | `.yesno` (two 60px buttons, No outline left, Yes pink right) | `yesNo()` |
| Page head | `header.page-head > .page-head-text > h1.page-title (+ span.accent) + p.page-sentence`, `.page-action` | `pageHead()`; title + one sentence + ONE primary (full width on phone) |
| Section | `section.section > .section-head > h2.section-title (+ .count) + .section-sub` | `section()` |
| Card | `.card` (18 radius, 24 padding, one shadow), `.card-head`, `.card-title`, `.card-sub`, `.card-foot`; `button.card` | a `.list` inside a card runs edge to edge |
| Grid | `.grid` (auto-fill 320px), `.grid-2` (two columns from 900px) | |
| Tiles | `.tiles > .tile > .tile-label + .tile-value + svg.tile-ico` | `tile()`; 88px (phone 96), `--surface-2`, value "—" when unknown |
| List | `ul.list > li > .row` (`.row-ico` 24 muted, `.row-main > .row-title + .row-sub`, `.row-end` with `.amount` and one action) | `list()`; 72px rows; titles wrap to 2 lines, never an ellipsis |
| Status | `.chip` + `.chip-good` / `-warn` / `-needs` / `-info`: an 8px dot + the word; `.chip-plain` = word only | `chip()`, `simChip()` / `testChip()` ("simulated vendor" / "test mode" in `--warn`) |
| Badge | `.badge` = 8px `--needs` dot (the count goes in words) | |
| Field | `.field > .field-label + .input (+ .field-help / .field-error)` (uiverse alexruix_jolly-emu-80, MIT); `.phone-field > .phone-cc + .input`; `.search-field > svg + .input` | `field()`, `phoneField()`, `searchField()`; 52px, radius 14 |
| Segmented | `.seg[role=radiogroup] > .seg-glider + button.seg-opt[role=radio][aria-checked]` (uiverse Admin12121_cold-bobcat-20, MIT) | `segmented()`; max 3 options; the glider slides |
| Toggle | `label.toggle > input[role=switch] + .toggle-track + .toggle-text` (uiverse adamgiebl_grumpy-moth-36, MIT) | `toggle()`; 52x32 track, 56px row |
| Empty | `.empty > .empty-ico + .empty-title + .empty-text + .btn`; `.empty-inline` (one muted sentence) | `emptyState()` |
| Skeleton | `.skel` + `.skel-line(.short)` / `.skel-row` / `.skel-card` (opacity pulse, no gradient) | `skeleton()` |
| Error / note | `p.error-line`, `p.note-line` | `errorLine()` |
| Banner | `.banner` (+ `.banner-warn` / `.banner-needs`: 2px left rule) | shell offline / live updates |
| Sheet / modal | `.sheet-root > .sheet-scrim + .sheet > .sheet-grip + .sheet-head (.sheet-title) + .sheet-body + .sheet-foot` | `openSheet()`; bottom sheet < 768px (radius 24 top, handle), centred modal 520 from 768px; no blur |
| Menu | `.menu > button.menu-item (+ .menu-check)`, `.menu-sep` | `openMenu()` |
| Language | `button.lang-switch > svg + .lang-switch-name[data-short] + .lang-switch-caret` | `langSwitch()`; phone shows "Eng" |
| Brand | `a.brand > img + .brand-word` | `brandMark()`; the real logo, never tinted |
| Keypad | `.pad`, `.pad-cells`, `.pad-cell(.is-on/.is-next)`, `.pad-text`, `.pad-keys`, `.pad-key(-del/-done)`, `.pad-msg` | `createKeypad()` |
| Read aloud | `.speak-wrap > button.speak[data-state] + .speak-note` | `speakButton(key)` (speak.js) |
| Tooltip | `[data-tip="word"]` (icon-only buttons) | |
| Toasts | sileo restyled: `--surface-2`, 1px `--line`, radius 14, 4px status left rule; bottom-centre above the phone tab bar, bottom-right on laptops | `notify()` |

## JS kit (`js/app/ui.js`) — exports are stable
```js
import { h, icon, scripted, fill, patch, rupees, money, qtyText, itemName, daysWord, initialsOf,
  button, dots, loader, pageHead, section, card, list, tile, chip, simChip, testChip, emptyState, skeleton,
  errorLine, field, phoneField, searchField, segmented, toggle, yesNo, openSheet, closeSheet, openMenu,
  closeMenu, langSwitch, uiLang, setUiLang, brandMark, notify, dismiss, createKeypad } from "./ui.js";
```
- `button({ word, icon, kind: "primary"|"secondary"|"ghost"|"danger", size: "lg"|"md"|"sm", onClick, href, label, busy, disabled, block })`
  — primary defaults to md (52), the others to sm (44 + 48 tap area); "hero" = "lg" (60).
- `loader(word)` three dots + a word; `dots()` the dots alone.
- `pageHead({ title, accent, sentence, action: {word, icon, onClick} | Node })`
- `section({ title, count, sub, action, body, id })`; `card({ title, sub, body, foot, onClick, needs, speakKey })`
- `list(rows, { limit = 5, label })`, rows `{ icon, title, sub, amount, end, onClick | href, label }`
- `tile({ label, value, icon, href | onClick })` — value `null` shows "—"
- `chip(word, { tone })`, `simChip()`, `testChip()`; `emptyState({ icon, title, text, action, inline })`;
  `skeleton("rows"|"cards"|"lines", n)`; `errorLine(text)`
- `field({ label, value, help, type, inputmode, autocomplete, multiline, validate, onInput })`, `phoneField({...})`,
  `searchField({ label, onInput })`, `segmented({ label, options: [{id, word, icon}], value, onPick })`,
  `toggle({ label, checked, onChange })`
- `yesNo({ onYes, onNo, busy: "yes"|"no"|null, yesWord, noWord, yesLabel, noLabel })`
- `openSheet({ title, body, footer, opener, label, onClose, speakKey, scrimCloses = true })` -> `{ el, setBody,
  setFooter, setBusy, close, isOpen }` (the Yes card passes `scrimCloses: false`)
- `openMenu({ anchor, label, items: [{ id, label, icon, lang, current, sep }], onPick })`
- `langSwitch()`, `uiLang()` ("en" default, `sahay-ui-lang`), `setUiLang(code)` (fires `sahay:ui-lang`; every screen re-renders)
- `brandMark({ word = true, size = 32, href = "#/home" })`
- `createKeypad({ length, mask, label, onDone, format, doneWord, autoAdvance })` -> `{ el, value, clear, setBusy, focus, shake, setError, setLocked }`
- Icons: `icon(name, size)`; names in `icons.js` (Tabler outline, MIT): home, cart, receipt, box (also `jar`),
  wallet, mic, bell, language, userCircle, user, check, x, chevronDown/Right/Left/Up, volume (also `speaker`),
  search, alert, alertTriangle, wifiOff, refresh, lock, store, robot, shield, clock, calendar, trendingUp, fileText,
  whatsapp, download, share, phone, fingerprint, keyboard, send, plus, minus, history, logout, users, cash, info,
  checkCircle, star, inbox, copy, link, truck, tag, sun, moon, spark, and more (`ICON_NAMES`). Always icon + word.

## Shell (`js/app/shell.js`, spec section 3)
- Laptop / tablet (768px+): sticky 64px top bar — logo + "Sahay" (links Home), five tabs Home / Buy / Sell / Stock /
  Money (44px pills, icon 20 + word; active = pink), right: the automated-assistant notice (from 1280px; a thin line
  under the bar below that), language (outline 40), "Needs you (n)" (outline 40, `--needs` dot; hidden at 0), account
  circle 40 (menu: My Sahay, Shop details, History, Log out).
- Phone (< 768px): 56px bar — logo + "Sahay", language ("Eng"), account; bottom tab bar 64 + safe area, icon 24
  over word 13/600, active in a 56x52 pink pill; "Needs you" = an 8px dot on the Home tab (and Home's card).
- On Home the shell's notice line steps aside: Home shows "Sahay is an automated assistant." under the Talk button.
- Routes: `#/home` (default; `#/sahay`, `#/talk`, empty), `#/buy` (`#/work`, `#/orders`), `#/sell`, `#/stock`, `#/money`,
  `#/me` + `#/me/<teach|voice|shop|history>` (`#/history`), `#/needs` (`#/waiting`), `#/signup`, `#/login`.
- A screen is `{ el, update(state, parts), enter?({ sub }), leave?() }`, mapped in `screens.js` (one line per owner);
  `AUTH` in screens.js is W5's log-in factory `({ mode }) -> { el, update, show, destroy }`.
```js
import { slots, setNeedsCount, onNeeds, openNeedsHost, setTitle, navigate } from "./shell.js";
slots = { main, needsHost, toastRegion, bannerSlot }
setNeedsCount(n)   // the "Needs you (n)" pill and the Home tab dot; W3's first call takes over from main.js
onNeeds(fn)        // the owner tapped "Needs you"; also the event "sahay:open-needs"
setTitle(text)     // "Text · Sahay"
```
Events: `sahay:talk` `{ mode, hint }` (start a call in place), `sahay:open-needs`, `sahay:ui-lang`.
