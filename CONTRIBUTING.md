# Contributing to Supstack

Thanks for your interest in Supstack! Bug reports, feature ideas, translations and pull requests are all welcome.

## Reporting bugs and asking for features

[Open an issue](https://github.com/RuslanGagushin/supstack/issues/new) and include:

- your platform (Windows, macOS or Android) and the app version (**Settings → About**);
- what you did, what you expected and what happened instead;
- a screenshot or a small sample note, if it helps show the problem.

## Setting up

You need **Node.js 20+** and, to run the native apps, **Rust** (<https://rustup.rs>). Then:

```sh
npm install
npm run dev        # the desktop app, without installing it
npm test           # page tests in headless Chrome (set CHROME_PATH to use another Chromium)
npm run test:rust  # the vault plugin's Rust tests
```

You can also work on the page alone: `npm run page` builds `web/supstack.html`, which opens straight from disk. **Try the demo vault** on the welcome screen gives you sample cards to work with.

See [How the app is put together](README.md#how-the-app-is-put-together) for a tour of the code.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one change, and describe what it does and why.
3. Respect the module layers: `core/` is pure logic, `services/` holds state and vault access, `ui/` draws. Each layer only imports the ones before it; `tests/architecture.test.mjs` checks this.
4. Add or update tests in `tests/` for behaviour you change, and make sure `npm test` passes.
5. Interface text lives in `web/src/js/core/strings.js` in English and Russian. Add both when you add a string (a rough translation is fine; it can be polished in review).
6. For visible changes, attach a before/after screenshot. If the README screenshots change, regenerate them with `npm run screenshots`.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
