# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start dev server (Vite, hot reload)
npm test           # run tests once
npm run test:watch # run tests in watch mode
npm run build      # type-check + build for production
npx tsc --noEmit   # type-check only
```

To run a single test by name:
```bash
npx vitest run --reporter=verbose -t "test name here"
```

## Architecture

The app is a vanilla TypeScript + Vite SPA with no framework. All logic lives in `src/`.

### `src/solver.ts` — constraint propagation engine
The core logic. `solve(text)` splits the input into lines and classifies each as an equation (`lhs = rhs`), a pure expression (no `=`), a comment, or empty. It then runs iterative constraint propagation: repeatedly scanning equations, and whenever exactly one unknown remains, solving for it using `math.derivative()` to get the linear coefficient (avoids catastrophic cancellation from finite differences). Returns a `LineResult[]` parallel to the input lines.

Result types: `'solved'` (unknown found), `'check-ok'`/`'check-fail'` (all vars known — validates), `'expression'` (pure expression evaluated), `'unsolved'` (multiple unknowns or nonlinear), `'error'`, `'empty'`.

Math parsing and evaluation uses **math.js**. `MATH_BUILTINS` filters out math.js constants/functions (pi, e, sin, …) so they aren't treated as unknowns.

### `src/main.ts` — editor + UI
Sets up a **CodeMirror 6** editor with a `ViewPlugin` (`solverPlugin`) that re-runs the solver on every document change and renders results as inline `WidgetType` decorations at the end of each line.

The `history` import from `@codemirror/commands` conflicts with `window.history` — it's aliased as `cmHistory` to resolve this.

URL sharing: on every doc change (debounced 300ms), content is written to `location.hash` via `window.history.replaceState`. On load, the hash is decoded and used as the initial document.

### `src/style.css`
Catppuccin Mocha dark theme. DM Sans (loaded from Google Fonts) for the header; monospace for the editor. CSS variables in `:root`.

## TypeScript config notes

`tsconfig.json` has `erasableSyntaxOnly: true` — constructor parameter properties (`constructor(readonly x: string)`) are not allowed; declare fields explicitly. `verbatimModuleSyntax: true` — type-only imports must use `import type`.
