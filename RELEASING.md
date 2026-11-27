# Before a release

Three things, in this order. Nothing else is required.

1. **Checks are green.** Run `npm run lint`, `npm run typecheck`, `npm run lint:rust`, `npm test` and `npm run visual`.
   If `npm run visual` says a screen moved and that was meant, open `tests/visual/<name>.diff.png`
   (red is what changed), then `npm run visual -- --update` and commit the new pictures with the change.
   The pictures are made on one machine's fonts: on a different machine, run `--update` once before relying on them.
2. **Two minutes by hand, on the phone and on the desktop app.** Open a note, change a line, make a new note,
   sync once, and look at one screen in dark mode.
3. **One line in `CHANGELOG.md`** under the version: what changed for you, in plain words.

Then follow `.claude/skills/release/SKILL.md` to bump, tag and push.
