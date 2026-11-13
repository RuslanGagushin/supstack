# Supstack design system

How the app's interface is put together: the variables every style draws from, the components built on them, and the rules the tests hold the styles to. The variables live in [`web/src/css/base.css`](../web/src/css/base.css); the components in the other six stylesheets, loaded in this order: `base`, `board`, `chrome`, `frame`, `writing`, `agenda`, `app`.

**The one rule:** a new value is a variable in `base.css` first. Colours, sizes, spacing, radii, shadows, layers, durations and weights are never written as numbers in a component's rule. `npm test` fails when one is (see [What the tests check](#what-the-tests-check)).

## Variables

### Colour

One palette, defined twice: on `body` for the light theme and on `body.theme-dark`. Components use these names only.

| Variable | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f8f8f7` | `#17181a` | the window behind everything: sidebar, list, fields |
| `--win` | `#ffffff` | `#1c1d1f` | sheets: the note, cards, menus, dialogs |
| `--panel` | `#f1f1ef` | `#2a2c30` | plates: chips, segment tracks, hovered rows |
| `--hover-bg` | `#f4f4f2` | `#25272a` | a control under the pointer |
| `--sel` | `#ececea` | `#303236` | the selected row; a control being pressed; text selection |
| `--line` | `#e9e9e7` | `#2e3034` | borders and separators |
| `--fg` | `#2a2c30` | `#dcdde0` | text |
| `--ink` | `#17181a` | `#f2f3f4` | text that has to stand out: titles, the active segment |
| `--muted` | `#55585e` | `#a9acb2` | secondary text; readable on every surface, plates included |
| `--faint` | `#686b72` | `#8e9198` | optional detail; 4.5:1 on `--bg` and `--win` **only**, never on `--panel`, `--sel` or `--hover-bg` |
| `--tag` | `#45484e` | `#c4c6cb` | text on a chip |
| `--accent` | `#4d64ff` | `#7c8eff` | links, focus, the chosen item, progress |
| `--accent-soft` | `#ebeeff` | `#1f2547` | an accent plate: an included filter, the selected agenda row |
| `--cta`, `--cta-hover` | `#4d64ff`, `#3245bb` | `#4d64ff`, `#7c8eff` | the primary button and its hover |
| `--panel-strong` | `#e4e4e1` | `#36383d` | the stronger plate: counts, priority A, an overdue date |
| `--todo` | `#c42f27` | `#ff7c70` | the only colour besides the accent: actions that destroy, errors, an invalid field |
| `--l2`, `--l3`, `--l7`, `--l8` | | | syntax colours in code blocks; content, not interface |
| `--flash`, `--code-bg`, `--tbl-head`, `--tbl-head-line` | | | search highlight, code blocks, table heads |
| `--on-accent` | `#fff` | `#fff` | text and marks on an `--accent`, `--cta` or `--todo` fill |
| `--paper` | `#fff` | `#fff` | the white of a page: a PDF, the switch's knob |
| `--shade` | `--fg` | `#000` | the colour of shadows and dims |

Three colours are worked out from the palette: `--accent-hover` (a primary control under the pointer), `--line-hover` (a border under the pointer) and `--scrim` (the dim behind a dialog).

### Type

| Variable | Value | Use |
|---|---|---|
| `--font-ui` | Inter | the interface and a note's text |
| `--font-code` | JetBrains Mono | code, keys, Markdown source |
| `--fs-sm` | 12px | the smallest text: dates, counts, chips, keys |
| `--fs-ui` | 13px | the interface's default |
| `--fs-md` | 14px | list titles, menu items |
| `--fs-note`, `--fs-text` | 16px | a note's text; the interface's larger text (the command palette's field, the phone's date strip) |
| `--fs-lg` | 20px | section titles |
| `--fs-xl` | 24px | the welcome title |
| `--h1-size` … `--h6-size` | 28, 24, 20, then 16px | a note's own headings (its title is 32px) |
| `--fw-regular`, `--fw-medium`, `--fw-semibold`, `--fw-bold` | 400, 500, 600, 700 | weights |
| `--lh-tight`, `--lh-ui`, `--lh-text` | 1.25, 1.5, 1.7 | titles and headings; the interface; a note's text |

Six sizes and no more (spec UI-20); `tests/typography.test.mjs` measures them on the page.

### Spacing, corners, sizes

| Group | Variables | Rule |
|---|---|---|
| Spacing | `--sp-2`, `-4`, `-6`, `-8`, `-10`, `-12`, `-14`, `-16`, `-20`, `-24`, `-32`, `-40`, `-48` | named by their size in pixels; every `padding`, `margin` and `gap`. Negative: `calc(var(--sp-8) * -1)`. In a note's text, `em` follows the font size and stays |
| Corners | `--r-xs` 6, `--r-s` 8, `--r-m` 10, `--r-l` 16, `--r-pill` | xs: keys, inline code; s: controls and rows; m: cards, menus, the note's sheet; l: dialogs; pill: chips and pill buttons. Circles are `50%` |
| Control heights | `--ctl-xs` 20, `--ctl-s` 24, `--ctl-m` 28, `--ctl-l` 32, `--ctl-field` 34, `--ctl-touch` 40 | xs: small chips; s: chips, icons in a row; m: fields, buttons in bars; l: sidebar buttons, menu rows; field: the search fields; touch: the least a finger gets (spec UI-9) |
| Icons | `--icon-xs` 12, `--icon-s` 14, `--icon-m` 16, `--icon-l` 18; `--icon-stroke` 1.75px | Lucide icons; one stroke |
| Bars | `--header-height` 40 | the sidebar's head |

### Depth, focus, motion, layers

| Group | Variables | Use |
|---|---|---|
| Shadows | `--shadow-1` | a raised segment, the switch's knob, the edge of a page or image |
| | `--shadow-2` | a card under the pointer, the note's sheet, the welcome card |
| | `--shadow-3` | menus, popups, the toast, bars that float |
| | `--shadow-4` | dialogs; the sidebar over the note |
| Focus | `--ring`, `--ring-inset` | a 2px accent ring outside a control, or inside the edge of a row or a pane. Buttons and links use `outline: 2px solid var(--accent)` |
| Motion | `--dur-1` 120ms, `--dur-2` 200ms, `--ease` | hover, folding, small changes; panels, bars, popups. `prefers-reduced-motion` cuts all of it |
| Layers | `--z-raised` 1, `--z-resizer` 3, `--z-float` 5, `--z-tabbar` 28, `--z-side` 30, `--z-editor` 35, `--z-welcome` 40, `--z-loading` 45, `--z-menu` 60, `--z-modal` 70, `--z-popup` 74, `--z-toast` 80 | from the page up; a neighbour one step above or below is `calc(var(--z-modal) + 1)` |
| Disabled | `--disabled` .4 | the opacity of anything that can't be used now |

## States

Every control has the same states, drawn the same way.

| State | Class or selector | Drawn as |
|---|---|---|
| Hover | `:hover` | `--hover-bg` behind, text to `--fg` |
| Pressed | `:active` | `--sel` behind (a primary button: `--cta-hover`); the one rule is the last in `app.css` |
| Keyboard focus | `:focus-visible` | outline or `--ring`; panes that take keys show `--ring-inset` only once Tab has been pressed (`body.sn-kb`) |
| Selected | `.is-selected` | the current row, day or item: `--sel` or `--accent-soft` |
| Picked | `.is-picked` | the notes marked in multi-select |
| On | `.is-active` | a switch, a tab, a segment, a toggled button |
| Today, now | `.is-current`, `.is-today` | |
| Collapsed | `.is-collapsed` | |
| Warning | `.is-warn` | `--todo` text |
| Disabled | `[disabled]`, `:disabled`, `.is-disabled` | `--disabled` opacity, no pointer events |
| Invalid | `[aria-invalid="true"]` on a field | `--todo` edge and a soft `--todo` ring; screen readers say it too |

## Components

Markup is made with `h(tag, attrs, ...children)` and `iconBtn(icon, label, onClick, cls)` from [`web/src/js/ui/dom.js`](../web/src/js/ui/dom.js).

### Button — `.sn-btn`

A labelled button, usually with an icon.

| Variant | Class | Use |
|---|---|---|
| Default | `.sn-btn` | transparent, `--muted` text, `--ctl-l` high |
| Primary | `.is-primary` | the one main action in a place: `--cta` fill, `--on-accent` text |
| Danger | `.is-danger` | an action that destroys something: `--todo` fill |
| Small | `.is-s` | inside a row of text |

```js
h("button", { cls: "sn-btn is-primary", type: "button", onClick: save }, ic("", "check"), t("save"))
```

Dialogs' buttons are plain `button` elements in `.modal-buttons`, with `.is-primary` or `.is-danger` on the main one. One primary button per dialog or bar.

### Icon button — `.clickable-icon`

An icon with no text; its name is in `aria-label` and `title`.

```js
iconBtn("trash-2", t("delete"), () => remove(path))
```

### Field

`input`, `textarea` and `select` get the base look from `base.css` at zero specificity (`:where`), so a field's own class always wins over it without `!important`. Height `--ctl-m`; focus `--ring`; invalid `aria-invalid="true"`; `select` is drawn by the app, with a chevron.

### Switch — `.checkbox-container`

`role="switch"`, `tabindex="0"`, `aria-checked`; Space and Enter flip it. On: `.is-active`, `--cta` track, `--paper` knob.

### Segmented control — `.sn-seg`

A `--panel` track of `.clickable-icon` segments, 28px (`.is-s`: 24px); the chosen one is a raised `--win` plate (`.is-active`, `--shadow-1`). A segmented control that switches views is `role="tablist"` with `role="tab"` and `aria-selected` on each segment.

```js
const seg = h("div", { cls: "sn-seg", role: "tablist" });
seg.append(h("button", { cls: "clickable-icon is-active", type: "button", role: "tab", "aria-selected": "true", text: "Week" }));
```

### Chip — `.sn-chip`

Tags, task dates, filters, notebooks. One plate: `--panel`, `--tag` text, `--fs-sm`, medium, `--r-xs`. No tone is a colour: the accent marks what is on, everything else differs in plate, weight and icon.

| | Class | Use |
|---|---|---|
| Size | (none) | 24px: chips that are controls (filters, the tag cloud) |
| | `.is-s` | 20px: chips in a row or a line of text (tags, dates, notebooks) |
| Tone | `.is-accent` | on, included: the accent plate |
| | `.is-danger` | due, excluded: `--panel-strong`, ink, semibold |
| | `.is-warn` | soon: ink on the plain plate |
| | `.is-outline` | inherited (a task's tag from its heading) |
| | `.is-struck` | excluded filter, with `.is-danger` |
| Kind | `.is-link` | a `span` chip that opens something (a tag in a list row) |
| | `.is-missing` | a parent not in the vault: dashed, not a link |

A chip that is a `button` or an `a` gets hover by itself. `#tags` in a note's text are `a.tag` (clicks find them by that) and share the chip's look; the tag being edited in Markdown (`.cm-sn-tag`) is a mark inside the editor's text and is drawn on its own.

```js
h("span", { cls: "sn-chip is-s is-link", text: tag, onClick: () => openTagView(tag) })
dateChip("dead", "Tomorrow", "soon")   // task-icons.js: a deadline chip, tone soon → .is-warn
```

A modifier repeats the base's `:is(.sn-chip, .markdown-rendered a.tag)`; the base has to outweigh the generic `button` rule, and a modifier written as `.sn-chip.is-x` would lose to it.

### List row and card — `.sn-card`

A note in the list is `.sn-card.sn-row` with `role="option"` in a `role="listbox"`; the open note is `aria-selected`, picked notes `.is-picked`. Arrow keys move between rows; Enter opens. Title first, then the text, then one line with the date, the tasks and the tags (spec UI-22).

### Tree — `.sn-outline`

The notebooks: `role="tree"` and `role="treeitem"` with `aria-level` and `aria-expanded`; one Tab stop, arrows move, Right and Left open and close, Enter opens a notebook's list. Rows `.tree-item-self`, children `.tree-item-children` with an indent guide.

### Menu — `.menu`

`role="menu"` of `.menu-item` (`role="menuitem"`): icon, title, an optional check. `.is-warn` for an item that destroys, `.is-disabled` for one that can't be used now. `--shadow-3`, `--z-menu`.

### Dialog — `.modal`

Over `.modal-bg` (`--scrim`), `--r-l`, `--shadow-4`, `--z-modal`; Escape closes it. Title, text, then `.modal-buttons`. The command palette and the pickers are `.prompt`: an input over a list of `.suggestion-item`s, arrows to move, Enter to choose.

### Toast — `.sn-toast`

`role="status"`, `aria-live="polite"`: one line at the bottom (at the top on a phone), with an Undo or other action button and a close button. `.is-quiet` for passing news (saved, synced). `--shadow-3`, `--z-toast`.

### Calendar — `.org-cal`

A month of `.cal-day` buttons in a `role="grid"`: arrows move a day or a week, PageUp and PageDown a month. The chosen day `.is-selected`, today `.is-today`, quick dates `.cal-q` (`.is-active` when chosen).

### Callout

In a note's text: `> [!type]` draws a frame with the type's icon and title; the icon is `--muted` for every type.

## What the tests check

`npm test` holds the styles to these rules (`tests/architecture.test.mjs` reads the stylesheets; the others measure the page):

| Rule | Test |
|---|---|
| every variable used is defined, and every variable defined is used | `architecture` |
| no colour functions outside `base.css`; no hex colours outside it either (alpha masks and the language badges in `markdown.js` aside) | `architecture` |
| pressing a button, an icon button or a row shows | `ui-list` |
| no numbers in `z-index`, `font-weight`, `transition`, `animation` (the spinners, the new card's flash and reduced motion aside) | `architecture` |
| corners are `--r-*`, `50%`, `0` or a 1–2px hairline | `architecture` |
| `padding`, `margin` and `gap` use the spacing scale; the few measured offsets are listed in the test with their reasons | `architecture` |
| one layer: no `body.sn-app`, and `!important` only on the hide utilities and for reduced motion | `architecture` |
| retired class names stay retired | `architecture` |
| six font sizes; a note's headings 32, 28, 24, 20px | `typography` |
| every text against its background, both themes: 4.5:1, 3:1 for large text | `a11y` |
| every Tab stop shows the focus | `a11y` |
| a chip's tone is drawn, not only named | `ui-markdown` |
