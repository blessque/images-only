# Code Style

## Naming

- Components: `PascalCase.tsx` — `Grid.tsx`, `Tile.tsx`, `UploadTray.tsx`
- Everything else: `camelCase.ts` — `gridParams.ts`, `solve.ts`, `manifest.ts`
- Params modules are named `<subsystem>Params.ts` and contain **only** exported constants
  with a comment per dial explaining what it does and what it traded against.
- Types shared with the Worker live in `src/lib/types.ts` and are imported with
  `import type`.

## File size

- **Soft limit 200 lines, hard limit 300.** Past that, split.
- A file over the limit is a signal that it holds more than one responsibility, which is
  also the point at which edits to it become unreliable — both for a human reading it and
  for a model holding it in context.

## Imports

- No deep relative chains (`../../../`). Use the `@/` alias for `src/`.
- `import type` for anything used only as a type. Non-negotiable across the `worker/` ↔
  `src/` boundary, where a value import compiles and then fails at the edge.
- Import order: external → `@/lib` → `@/grid` → relative → styles.

## TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`. The grid solver indexes arrays constantly;
  this flag is what stops an off-by-one from becoming `undefined.width` at runtime.
- No `any`. `unknown` + a narrow, then handle the failure.
- No non-null assertions (`!`) in `src/grid/` — the solver's correctness is the product.

## CSS

- Plain CSS with custom properties. No CSS-in-JS, no Tailwind — the site has perhaps 60
  lines of real styling, and a utility framework would outweigh it.
- Grid geometry is written by the solver as **inline styles** (computed widths/heights).
  Everything else is in stylesheets. Do not mix: if a number is solved, it is inline; if it
  is a constant, it is CSS.
- Colours as custom properties in one place. 2–3 greys, black, white. If a change needs a
  fourth colour, that is a design decision to raise, not a value to add.

## Comments

- Comment the **why**, never the what. `// clamp: a row of portraits solves to 3000px` is
  useful; `// set the height` is noise.
- When a value was tuned or an approach was rejected, say so at the value, and put the full
  reasoning in `docs/decisions/TUNING_LOG.md`.
