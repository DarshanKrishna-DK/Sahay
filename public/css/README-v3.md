# Sahay UI v3: shell and component contract (W1, kept current)

Owner of this file and of everything it lists: W1 SHELL. W2-W5 build on it; ask W1 (via the
coordinator) for a change rather than restyling a primitive locally. Plan:
`docs/superpowers/plans/2026-11-20-ui-v3-build.md`; spec: `docs/superpowers/specs/2026-11-20-sahay-ux-v3.md`.

Status legend: **ready** = in the tree now; **soon** = named here, landing next in W1 commits (code
against the name now).

## 0. Stylesheets (app.html load order)
| File | Owner | What |
|---|---|---|
| `css/tokens-v3.css` | W1 | every token (section 1), light theme, Indic font rules. **ready** |
| `css/components-v3.css` | W1 | base reset, focus, every component class (section 2). **ready** |
| `css/app-shell.css` | W1 | hex field, NavJelly, NavDock, NavRail, TopCapsule/TopStrip, slots, layout per size, view transitions. **ready** |
| `css/app-sell.css` | W4B | Sell/Stock/Money screen rules. |
| `vendor/sileo-0.1.6/sileo.css`, `css/app-toast.css` | W1 | toasts, lime/piano theme. |
| `css/app-agent.css` W2, `css/app-waiting.css` W3, `css/app-buy.css` + `css/app-stock.css` W4A, `css/app-sell.css` W4B, `css/app-me.css` + `css/app-auth.css` W5 | each owner | linked directly from app.html after `app-shell.css` (no `@import`). The v2 `app.css` is deleted. |

Rules: tokens only (no raw hex in screen CSS except inside `rgba(var(--hex-rgb), a)`-style token use);
`letter-spacing: 0` on hi/kn; owner text >= 16px (body 18px, Indic 19px); every animation has a
`prefers-reduced-motion: reduce` branch; never put `filter`, `opacity < 1`, `mask`, `transform`,
`will-change`, `mix-blend-mode`, `view-transition-name` or `backdrop-filter` on an ANCESTOR of a glass element (it becomes the
backdrop root and the hex field stops showing through). Screens live inside `#main`; do not wrap `#main`.

## 1. Tokens (`css/tokens-v3.css`) **ready**
- Lime scale `--lime-50 ... --lime-900`, `--lime` (= 400 `#B6F23C`), `--lime-hi`, `--lime-lo`.
- Piano surfaces `--piano-0` (page) ... `--piano-5`; `--piano-surface`, `--piano-surface-hover`,
  `--piano-rim`, `--piano-sheen`; `--paper`, `--perforation`.
- Text `--text-hi`, `--text-md`, `--text-lo` (lowest allowed for sentences), `--text-faint` (decor only).
- Meaning `--accent` / `--accent-text` / `--on-accent`; `--ok` / `--ok-text` (lime + check);
  `--coral` / `--coral-text` / `--on-coral` (needs you, no, error + alert); `--amber` / `--amber-text` /
  `--on-amber` (waiting, reconnecting + clock); `--cyan` / `--cyan-text` (vendor side, simulated vendor).
- Glass `--glass-fill`, `--glass-fill-strong` (no-blur fallback), `--glass-tint`, `--glass-blur`,
  `--glass-rim`, `--glass-highlight`, `--glass-shadow`.
- Borders `--edge` (>= 3:1, anything pressable or floating), `--edge-strong`, `--hairline` (dividers),
  `--edge-accent`.
- Radii `--r-xs 10` `--r-sm 14` `--r-md 20` `--r-lg 28` `--r-xl 36` `--r-pill` `--r-card 28` `--r-soft 22` `--r-notch 13`.
- Space `--s-1 4` ... `--s-9 96`; targets `--touch-min 48`, `--touch 56`, `--touch-lg 64` (keypad),
  `--touch-yes 88`.
- Type: `--font-display` / `--font-num` (Space Grotesk), `--font-body` (Instrument Sans), `--font-deva`,
  `--font-kn`; sizes `--fs-xs 14` (nav words only), `--fs-sm 16`, `--fs-body 18`, `--fs-body-indic 19`,
  `--fs-lead 22`, `--fs-h3`, `--fs-h2`, `--fs-title`, `--fs-amount 30`, `--fs-onhand 40`,
  `--fs-total 48-56`, `--fs-number`; `--lh-tight`, `--lh-body`, `--lh-indic 1.65`; weights
  `--fw-body`, `--fw-strong`, `--fw-display`.
- Shadows `--shadow-1/2/3`, `--shadow-float`, `--depth` (lip), `--depth-soft`, `--press` (:active),
  `--glow-lime` (small, max); surfaces `--btn-surface` (lime keycap), `--danger-surface`, `--btn-rim`.
- Focus `--focus-ring` (alias `--focus`): 3px page gap + 3px lime.
- Motion `--t-micro 120` `--t-fast 160` `--t-med 220` `--t-slow 320` `--t-enter 420` `--t-page-out 180`
  `--t-page-in 380`; `--ease-out`, `--ease-in`, `--ease-soft`, `--ease-spring` (real spring via
  `linear()` where supported); `--stagger 60ms`.
- Z-layers `--z-hex 0`, `--z-content 1`, `--z-column 20`, `--z-nav 40`, `--z-calldock 44`,
  `--z-banner 46`, `--z-pill 48`, `--z-popover 60`, `--z-toast 65`, `--z-sheet 80`, `--z-skip 100`.
- Hex field `--hex-rgb`, `--hex-alpha`, `--hex-pitch`, `--hex-dot` (read by `hex-field.js`).
- Layout `--safe-t/r/b/l`, `--nav-w` (88 / 104), `--nav-inset 16`, `--rail-w 72`, `--dock-h 68`,
  `--dock-gap 12`, `--dock-orb 64`, `--dock-lift 18`, `--capsule-h 56`, `--agent-col 380/420`,
  `--content-max 1120`, `--pad-x 16/24/32`.
- Compat names kept with v3 values (fine to use): `--ink-0..3`, `--glass`, `--glass-strong`,
  `--glass-border`, `--leaf`, `--leaf-text`, `--fs-small`, `--r-blob`, `--shimmer`, `--leaf-surface`.
- Breakpoints (media queries; CSS vars cannot be used in them):
  phone `max-width: 599px`; phoneLand `(max-height: 500px) and (min-width: 568px) and (orientation: landscape)`;
  tablet `600-1023`; laptop `1024-1599` (column from 1280); wide `>= 1600`. JS: `shell.layout().size`.
  `<html data-size="phone|phoneLand|tablet|laptop|wide">` is set by the shell (prefer it in CSS:
  `:root[data-size="phone"] .x {}`), plus `data-keyboard="open"` while the phone keyboard is up.

## 2. Component classes (`css/components-v3.css`) **ready**, JS helpers in brackets
Every interactive class has hover, `:focus-visible` (lime ring), `:active` (press), `[disabled]`
/ `[aria-disabled="true"]`, and busy (`[aria-busy="true"]`) styles; selected uses `[aria-pressed]`,
`[aria-checked]` or `[aria-current]`, never a bare class.

| Component | Markup / helper | States |
|---|---|---|
| Glass panel | `.glass` (blur + tint + edge); add `.glass-rim` for the gradient rim | fallback fill without blur |
| Piano card | `article.card` (alias `.piano`); `.card-pad-lg`; `.card-interactive` (whole card is a button/a); `.card-now` (being spoken: lime rim + pulse); `.card-alert` (coral rim) | hover, press, focus |
| Card head + read-aloud slot | `header.card-head > h3.card-title + span.card-speak` (put `speakButton(key)` in `.card-speak`; it sits top-right, 48px, same spot on every card, sheet title and screen header) | |
| Receipt paper | `.paper` + `.paper-due` / `.paper-paid` / `.paper-pending`; `--notch-y`; `span.perforation` at the same height [`paper()`, `perforation()` in ui.js] | |
| Pill (static marker, icon + word) | `.pill` + `.pill-sim` (simulated vendor, cyan) / `.pill-test` (test mode) / `.pill-ok` / `.pill-due` / `.pill-wait` [`pill(word, icon, tone)` in ui.js; old `.mark-*` still styled] | |
| Chip (small control) | `button.chip` icon + word, 48px tall; `.chip-talk` (the "बोलें" chip) [`talkChip(hintKey)` in ui.js, starts the call IN PLACE per D11] | pressed via `[aria-pressed="true"]` |
| Keycap button | `button.keycap` + `.keycap-primary` (lime) / `.keycap-secondary` (piano) / `.keycap-danger` (coral) / `.keycap-ghost`; sizes `.keycap-lg` 64 / `.keycap-md` 56 / `.keycap-sm` 48; `.keycap-block` full width [`keycapButton({icon, word, label, onClick, tone, size, busy})`] | busy shows `.spinner` in place of the icon |
| Classic buttons (kept, v3 look) | `.btn` + `.btn-primary` / `.btn-ghost` / `.btn-danger`, `.btn-lg` / `.btn-sm`; `.icon-btn` (48), `.icon-btn-lg` (64) | |
| Yes / No pair | [`yesNo({onYes, onNo, busy, yesWord, noWord, yesLabel, noLabel, size})`] -> `.yes-actions > .yes-btn.yes-btn-no + .yes-btn.yes-btn-yes`; 88px circles, No left, Yes right, 24px apart; `size: "lg"` makes Yes 104 | busy "yes"/"no" spinner, disabled, done |
| Big number | `.bignum` + `.bignum-total` (48-56) / `.bignum-amount` (28-32) / `.bignum-onhand` (40); unit `span.bignum-unit`; Indian grouping via `rupees()` in dom.js | |
| List row | `ul.rows > li.row` with `.row-ico`, `.row-main > .row-title + .row-sub`, `.row-end`; a whole-row control is `a.row-button` / `button.row-button` inside the `li` | hover, press, focus, `[aria-current]`, `.is-busy`, `.is-error` |
| Empty / loading / error | [`stateView({kind:"empty"|"loading"|"error"|"missing", icon, title, text, action})`, `loadingView()`, `talkAction(hintKey)`, `skeleton(shape)` in empty.js] -> `.state`; skeletons `.skel`, `.skel-line`, `.skel-block`, `.skel-circle`, `.skel-card` | shimmer stops under reduced motion |
| Inline error / note | `p.error-line` (role alert, alert icon + one line) / `p.note-line` (info icon) | |
| Badge | `span.badge` (coral count; 1-9, then "9+") [`badgeText(n)` in ui.js] | |
| Status stamp | `span.stamp` + `.stamp-draft` / `.stamp-waiting` / `.stamp-issued` / `.stamp-part` / `.stamp-paid` / `.stamp-cancelled` (icon + word) | |
| Spinner | `span.spinner` (currentColor) | static under reduced motion |
| Text field | [`textField({label, value, help, type, inputmode, autocomplete, validate, onInput})` in ui.js -> `{el, input, value, setError(text|null), setState("idle"|"saving"|"saved")}`] -> `label.field > .field-label + .field-input + .field-help + .field-error` | pristine never red; error on first blur; clears on focus/keystroke (forms skill) |
| Choice tiles (2-4) | [`choiceTiles({label, options:[{id, icon, word, lang}], value, onPick})`] -> `.choices[role=radiogroup] > button.choice[role=radio][aria-checked]` | saving `.is-saving` |
| Segmented control | [`segmented({label, options, value, onPick})`] -> `.seg > button.seg-opt[aria-pressed]` | |
| Keypad | [`createKeypad({length, mask, label, onDone, format, doneWord, autoAdvance})` in keypad.js -> `{el, value, clear, setBusy, focus, shake, setLocked(text|null), setError(text|null)}`] -> `.pad` 64px+ keys | mismatch shake, locked, busy, auto-advance at full length |
| Sheet / drawer / modal | [`openSheet({title, body, opener, speakKey, place, kind, onClose, footer, label, closeLabel})` in sheet.js -> `{el, setBody, setFooter, setBusy(b, text?), setError(text|null), close(), isOpen()}`]; `place` defaults per size (phone bottom sheet, phoneLand right drawer, tablet centred bottom sheet 560, laptop centred modal 560); `kind: "yes"` uses the drawer at 1024+; `closeLabel` turns the X into a worded chip ("Later"); `placeFor(kind)` is exported | opening, open, scroll, busy, error, closing; scrim; focus trap; Esc; swipe down (sheet) |
| Popover (language only, D18) | [`openPopover({anchor, label, items:[{id, label, lang, current}], onPick})` in menu.js] -> `.popover > button.popover-item[role=menuitemradio]` | current, saving, error |
| Picker sheet | [`openPicker({title, items:[{id, label, sub, lang}], current, searchLabel, emptyText, onPick})` in menu.js] -> big rows + search field | typed, no match, selected |
| Screen header | [`screenHeader({title, speakKey, talkHint, actions})` in ui.js] -> `header.screen-head > h1.screen-title + .screen-head-tools` (speaker, talk chip, up to 2 actions) | |
| Section | `h2.section-title`; collapsible block `details.fold > summary.fold-head` (count in `.fold-count`) | open / closed |
| Tooltip | `[data-tip="word"]` on icon-only controls (hover and keyboard focus, never title=) | |

## 3. Shell API (`js/app/shell.js`) **ready**
```js
import { slots, onLayout, layout, setNavAgentState, setBadge, setTitle, setAction, navigate, ROUTES } from "./shell.js";
slots = { main, topCapsule, waitingPill, agentColumn, dockSlot, toastRegion, sheetRoot, bannerSlot }
onLayout(fn) -> unsubscribe   // fn({ size: "phone"|"phoneLand"|"tablet"|"laptop"|"wide", keyboardOpen, columnShown }) now and on change
layout()                      // the current object above
setNavAgentState(state)       // agent state ("idle","listening","thinking","speaking","working","connecting",...) -> nav orb
setBadge(key, n)              // key: "sahay"|"buy"|"sell"|"stock"|"money"|"me"|"waiting"; 0 hides; coral dot on the nav item + aria-label
setTitle(text)                // document.title "<text> | Sahay"
setAction({ icon, word, label, run } | null)   // one contextual action in the TopStrip (600px+; phones use the screen header); cleared on every route change
navigate("#/buy")             // same as location.hash, kept for symmetry
claimBadges()                 // optional: the first non-interim setBadge call also takes the counts over from main.js
toggleTheme()                 // dark <-> light, saved on the device (My Sahay can offer it on phones)
setLanguageSaver(fn)          // main.js wires the profile save; the sidebar language chip uses it
```
- `slots.dockSlot` (W2's CallDock) is MOVED by the shell to the right place: phone = riding on the dock
  orb; tablet / 1024-1279 = floating bottom-right; 1280+ = top of `agentColumn`. It carries
  `data-place="dock"|"float"|"column"`. Hidden while the phone keyboard is open.
- `slots.waitingPill` (W3): phone = hangs under the TopCapsule; tablet / 1024-1279 = top-right;
  1280+ = hidden (the tray lives in `agentColumn`). Carries `data-place`.
- `slots.agentColumn` (W3 tray, W2 dock via dockSlot): shown only at 1280+; empty column collapses.
- `slots.sheetRoot`: sheet.js and menu.js mount here. `slots.toastRegion`: toast host.
- `slots.bannerSlot`: shell renders the offline banner (D15) and "live updates closed + Retry" here;
  others may append one `.banner` each.
- Document events: `sahay:talk` `{mode, hint}` start a call in place (never navigates, D11);
  `sahay:hint` `{key}`; `sahay:open-tray` (W3 opens the tray; route `#/waiting` fires it);
  `sahay:compose` (W2 opens the composer); `sahay:layout` (same payload as onLayout).
- The nav orb (top of NavJelly, centre of NavDock): from another screen one tap = go to `#/sahay`; on
  `#/sahay` it dispatches `sahay:talk` (D11). It never ends a call (D12).

### Routes (`shell.js ROUTES`, factories in `screens.js`)
| Hash | Screen id | Aliases |
|---|---|---|
| `#/sahay` (default, empty hash) | `sahay` | `#/talk` |
| `#/buy` | `buy` | `#/work`, `#/orders` |
| `#/sell`, `#/stock`, `#/money` | same | |
| `#/me`, `#/me/teach`, `#/me/voice`, `#/me/shop`, `#/me/history` | `me` (gets `enter({sub})`); `me/history` uses the `me/history` factory if registered | `#/history` -> `#/me/history` |
| `#/waiting` | stays on the current screen, fires `sahay:open-tray` | |
| `#/signup`, `#/login` | auth (before a session) | |
A screen is `{ el, update(state, parts), enter?({sub}), leave?() }`. `screens.js` maps id -> factory;
each owner edits only its own line there (W2 `sahay`, W4A `buy`/`stock`, W4B `sell`/`money`, W5 `me`, `me/history`).

## 4. Icons (`icon(name, size)` in dom.js, 24px stroke) **ready**
mic, micOff, keyboard, plus, check, x, pause, speaker, phoneOff, talk, river, receipt, spark, history,
sun, moon, search, ear, handshake, doc, download, rupee, bell, send, alert, wifi, store, robot, globe,
gauge, turtle, heart, ban, box, tag, arrowLeft, arrowRight, user, pin, refresh, headphones, external,
chevronUp, truck, fingerprint, lock, phone, backspace, cart, share, wallet, cash, info, logout, jar,
users, moneyIn, checkCircle, shield, key, **sahay** (agent mark), clock, chevronDown, chevronRight,
chevronLeft, languages, star, inbox, wifiOff, stop, minus, calendar, sliders, copy, link, home.
Nav: Sahay = live thinking orb (canvas), Buy = cart, Sell = receipt, Stock = jar, Money = wallet, My Sahay = avatar orb.

## 5. Thinking orb, toasts
- `createThinkingOrb({size, state, color, lightColor, label})` (thinking-orb.js): default tint is now
  lime `#B6F23C` (dark) / `#415F04` (light). Sizes 20 / 40 / 64 or the big orb; size the wrapper, never CSS-scale.
- `notify({...})` (toast.js) unchanged API; theme in app-toast.css: glossy piano fill, lime success,
  coral error (stays), amber warning; placement per spec 6.3 (phone top under the capsule, max 2;
  laptop top-right of content, left of the agent column, max 3).

## 6. Removed (do not reference)
- Files gone: the v2 edge module, `js/app/nav.js`, the v2 token file, the temporary bridge sheet.
- Classes gone: the edge orb (`.edge*`, `.eb-*`), `.pillnav`, `.nav-link(s)`, `.nav-ico`, `.nav-word`,
  `.nav-badge`, `.nav-avatar`, `.top-avatar`, `.avatar-ring`, `.topstrip`, `.top-brand`, `.top-right`,
  `.logo-orb`, `.live-in-nav`, `.live-in-top`, `.theme-btn`, `.aurora` (and its dot grid), the yes-layer
  column padding hack, `.state-orbit`, `.state-blob`.
- Tokens gone: the v2 orange accent family and its glow, `--aurora-a/b/c`, `--dot-color`. Use
  `--accent` / `--accent-text` / `--lime` / `--glow-lime`.
- Keycap tones: `primary | secondary | danger | ghost` only (the v2 orange tone and `.keycap-leaf` map to
  `primary` in `keycapButton`; write `keycap-primary` in markup).
- Edge actions moved (D5): Talk -> nav orb / Sahay home orb; Type -> composer (`sahay:compose`);
  Approve -> waiting tray (`#/waiting`, `sahay:open-tray`); Pause -> End in the call dock; New need -> dropped.
- i18n keys `edge.*` are deleted.

## 7. Cleanup gate (prints nothing)
`grep -rniE "<v2 accent names>|<v2 orange hex codes>|<edge orb file>|<v2 token file>" public --exclude-dir=vendor --exclude-dir=figures`
(the exact pattern is in the build plan / coordinator message; this file avoids spelling the words so
the gate stays clean). app.html loads only v3 stylesheets.
