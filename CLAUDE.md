# Hotseat

Two-team trivia game. One player sits in the hot seat and answers; miss, and the other team can
steal the question, the money, and the seat.

Three surfaces run simultaneously from one shared game state:

| Surface | URL | Role |
|---|---|---|
| Host console | `#host` | The operator. **The only surface that writes game state.** |
| TV display | `#display` | Read-only. Renders what the host committed, plays the score. |
| Phone | `#player` | One per player. Submits *requests*; the host applies them. |

State lives as a single JSON blob in a Supabase `kv_store` row, one row per lobby, keyed
`lobby:<slug>`. Every surface polls it. There is no server-side logic.

## Deploy

GitHub Pages serves `main` from the repo root. **Deploy is `git push`.** Nothing is uploaded to
Supabase — that is only the database. No build step: Pages serves over HTTPS, so the browser
loads the ES modules directly.

## Where things are

Start here rather than grepping. Most edits touch exactly one file.

```
index.html            59 lines: head, stylesheet links, SVG defs, #app-root, modal markup
src/main.js          204 lines: routing, poll loop, keyboard shortcuts, boot, handler barrel

src/core/
  state.js       the state schema and the single live `state` object
  session.js     per-tab flags: which surface, which lobby, UI flags
  lobby.js       load / save / create / list a lobby
  db.js          Supabase kv_store; falls back to localStorage if SUPABASE_URL is blank
  constants.js   ladder money, lifelines, brand asset paths
  bank.js        the global question bank: one row, host-only, permanent
  bank-format.js parse / serialise the bank's text form (pure, tested)
  util.js        esc, money, genId, slugify, debounce, shuffleArray

src/rules/       game logic - no markup
  flow.js        draw -> reveal -> answer -> steal. state.flow.stage drives every surface
  lifelines.js   the four lifelines + the phone request channel
  puzzle.js      letter board, guess timer, solving
  wager.js       the Final Wager
  score.js       manual adjustments, end game, new game
  bank-edit.js   the textarea editor's actions
  players.js     roster, teams, hot seat order
  phone.js       what a phone is allowed to submit
  ladder.js      player lookups, level helpers, winLevel
  pool.js        drawing from the bank, and spending what is drawn
  wheel.js       Wildcard outcome pool and resolution
  sus.js         Sus mode: roles, dealing, scoring, voting, suspension

src/ui/          markup fragments, no game logic
  atoms.js       ladder strip, difficulty pill, team roster, lifeline bar
  icons.js       chair emblem, wordmark, team flame, TV icon paths
  modal.js       the confirm / picker dialog
  wheel-view.js  wheel markup and the spin animation
  puzzle-view.js board, keyboard, timer markup
  rerender.js    the render bus (see below)

src/screens/     one file per surface
  host/          the operator console, one file per tab (incl. sus.js)
  display.js     the TV          display-sus.js  the TV in Sus mode
  player.js      the phone       player-sus.js   the phone in Sus mode
  entry.js       lobby entry, claim, lobby list, end screen
  display-audio.js  Web Audio score (TV only)

src/dev/testdata.js   sample players and questions
styles/               tokens, base, components, host, display, player
```

## Four things that will bite you

**1. Inline `onclick` handlers run in global scope.** Generated markup is full of
`onclick="flowAdvance()"`. Module scope is not global, so every such function must be
republished on `window` by the barrel at the bottom of `main.js`. Add an inline handler, add it
to the barrel — otherwise the button silently does nothing.

Never *assign* a variable from an attribute (`onclick="someFlag=true"`). It writes to `window`,
not to the module, and the read side never sees it. Call a setter instead — see
`setPromoteMenu` in `screens/player.js`.

**2. Rules must not import screens.** Screens import rules, so the reverse would be a cycle.
Rules trigger a repaint through `ui/rerender.js` — `R.host()`, `R.player()`, `R.all()` — which
`main.js` binds at boot.

**3. `state` is a live binding.** Import it and mutate its properties freely. You cannot
reassign it; the three places that swap the whole object call `setState()`. The same pattern
applies to session flags: read the import directly, write through the setter.

**4. Run the checkers after any change.**

```bash
python3 tools/check-modules.py
node tools/test-sus-rules.mjs
node tools/test-bank-format.mjs
```

`check-modules.py` catches five things `node --check` cannot, every one of which has actually
shipped a silently broken surface here:
- imports buried in a header comment (valid JS that does nothing)
- a module using an unexported binding from another file
- imports naming something the target does not export
- a function called from an inline `onclick` that `main.js` never puts on `window` — the button
  renders and does nothing
- a CSS custom property used but never defined — the declaration is dropped and the element
  keeps its inherited colour, which on the TV means dark ink on a dark stage

`test-sus-rules.mjs` covers the Sus scoring and voting maths in plain node, and
`test-bank-format.mjs` the bank parser — the one thing standing between a paste into a textarea
and the whole question library.

## The question bank

One global library in its own `kv_store` row (`bank:v1`), **not** in the lobby blob — every
surface polls that blob, and at a thousand questions the bank alone would be ~177KB a tick to
the TV. Only the host loads it.

Edited as one textarea on the Setup wizard's Questions step:
`Question text | correct | wrong | wrong | wrong`, one per line, a leading `x` (optionally
`x2026-08-25`) marking a question retired. Retirement is **permanent** — there is no reset.
A save that does not parse is refused with line numbers and leaves the stored bank untouched;
the previous version is kept at `bank:v1:prev` for one-step undo.

**Test mode** stops a drawn question being retired. It is forced on whenever `SUPABASE_URL` is
blank, which is exactly the local throwaway build — so our own runs can never burn the real
library. There are no difficulty tiers; every level draws from the whole bank.

## Testing locally

`file://` will not work — ES modules are CORS-blocked there. Serve the directory:

```bash
python3 -m http.server 8765
```

To exercise the game without touching production data, copy `src/` and blank `SUPABASE_URL` in
the copy's `core/db.js`; the code falls back to `localStorage`. Point a copy of `index.html` at
the copied tree. Give the copy a fresh directory name each time — a query string busts the
cache for `index.html` but **not** for the `.js` modules it imports, which will silently serve
you stale code. **The same applies to the stylesheets** — `index.html` links them without a
version, so a query string busts the modules but not the CSS. Rewrite the `<link>` hrefs with
the same stamp, or you will debug a surface that is rendering last week's styles.

## Known wart

`rules/ladder.js` imports `startWager` from `rules/wager.js`, which imports back through
`score.js`. ESM resolves the cycle because the bindings are hoisted function declarations, but
`winLevel` reaching directly into the Final Wager is the wrong layering. Worth untangling if
that area is touched.
