# Changelog

One line per release, newest first: what changed for you.

## 0.37.1

- Thirteen small fixes from a close look at the page on desktop and phone: subtasks line up, headings fold tidily on narrow screens, the search bar and notebook tiles fit without cutting words, card previews and the demo notice read cleanly, agenda rows and the side panel line up, tags look the same everywhere, an empty search offers a way out, and Russian says «Повестка».

## 0.37.0

- Tables can be worked on as a whole: handles select rows and columns, a drag moves them, dragging across cells or Shift+arrows selects a block, and the bar above it inserts, aligns, sorts, clears or deletes it. Copy, cut and paste work on selections (including spreadsheet cells or a Markdown table), and on a phone a tap low in the last row edits its cell instead of adding a row.

## 0.36.9

- On desktop, opening a notebook with its own text shows that text beside the list of child notes instead of opening the first child.

## 0.36.8

- A note that starts or ends with a table: click or tap under the last table, or between the title and the first one, to write a paragraph there. Enter in the title and ↑ from a table's header row also open a line above it, and text typed right against a table no longer becomes a table row.

## 0.36.7

- Notes read lighter: the text is 14px instead of 16px, the note's title 30px instead of 40px, and the headings scale with them, as in Evernote. Inline code matches the text around it.

## 0.36.6

- Phone: a tapped button or row no longer stays highlighted, toasts wrap instead of cutting the message short, and the settings tabs wrap so About is no longer hidden off the edge. The agenda's Day/Week/Month switch fades at the edge when it scrolls.
- Easier to read: the primary button when pressed in dark mode, delete buttons in dark mode, and the text of a chip that is on. The sidebar's open tag and the Files "unused" filter show a check when on, and blue tags no longer look like the accent.
- Quick capture: labels line up and no longer run into their fields in Russian, Save stays in view when the window is zoomed in, and the date field's full syntax shows under it. Disabled menu items look disabled again.

## 0.36.5

- Task rows: in edit mode, away from the caret, dates show as the same chips as in reading view ("Tomorrow" with the repeat icon) and `[#A]` as the A badge; the caret brings back the Markdown of just the line it is in. In reading view a wrapped task title continues under its text, not under the box, and on a phone the fold arrow has its own tap area apart from the box.
- Phone sync: a sync that stopped partway no longer misses a note that the other device changed to text of the same length.

## 0.36.4

- Icons in the notebook's bar, the note's header and its toolbar are one size: 16px on a desktop, 20px with a full tap area on a phone. On a narrow note, Done is a blue check instead of a filled blue square.

## 0.36.3

- The note's header: the edit pencil and ⋮ are new icons at one size with a full tap area on a phone, and the side panel opens with the same panel icon on a phone as on a desktop (no more "i").

## 0.36.2

- Looks: hover changes ease in one speed, a press answers at once, the floating "demo vault" notice has a border and shadow,
  the properties panel's tag field and add button line up with the values, and `npm run visual` checks six key screens.
- Phone: the note's top bar shows a back arrow and the note's full name, the Edit pencil looks like the icons beside it, and the title sits higher. Agenda: empty days use the same heading type as the others, only quieter, and the filter chips have more room under the toolbar.
