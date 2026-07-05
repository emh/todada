# Mondrian / Todo

> Design your day. Find balance. Get things done.

A todo app in balance: the screen **is** the task list — a Mondrian grid where **every rectangle is a task** and the thick black lines are the structure of your day. Adding a task means subdividing the canvas; completing one turns its block white, and open space restores calm. Based on `mocks/mondrian-ux.png`. Vanilla JS, no build step — serve the repo root and open `/mondrian/`.

## The composition

The layout is a recursive split tree (BSP): every block is a leaf, every black line a division. Nothing floats — geometry is meaning:

| Property | Encodes |
|---|---|
| **Color** | Context — red urgent, blue work/project, yellow personal/quick, white open/neutral |
| **Size** | Effort / importance (give a task more room by resizing or moving it to a bigger block) |
| **Position** | Urgency / schedule weight |
| **White** | Complete, or open space |

Blocks show title + due date (⚠ when overdue), a corner flag for high priority, and scale their type down as they shrink.

## Gestures

| Gesture | Effect |
|---|---|
| **+** then **tap a block** | Split it along its longer axis — the grid reflows, and the New Task card names the new block. Cancel reverts the split. Blocks too small to divide refuse |
| **Tap** a block | Inspect: subtasks, due date, priority, category, notes, complete, merge, remove |
| **Tap** open space | Fill it with a new task |
| **Drag a divider** | Resize — live, with minimum block sizes enforced |
| **Slow-drag** a block onto another | Swap their positions (a ghost label follows your finger, the target highlights) |
| **Fast swipe** across a block | Complete — it slides under your finger, then turns white with a ✓. Undo via toast |

## Features

- **Merge & group** — inspect offers *"Merge with [neighbor]"* for sibling blocks: the two collapse into one project block, and both former titles become its subtasks (e.g. *Project Research* + *Client Presentation* → *Website Redesign (Project)*).
- **Daily structure** (⋯ menu) — Structured, Focused, Sparse, or Intensive grid templates, each with a generated thumbnail. Applying one re-lays your tasks into the template: **the biggest slots go to the highest priority**, and the grid auto-splits if you have more tasks than slots.
- **Balance** — the app computes the weighted center of mass of the colored blocks; when the composition leans too far it warns *"Your composition is becoming unbalanced. Consider redistributing your tasks."* with a one-tap **Redistribute**.
- **Smart notices** — *"2 blocks are overdue. Review and reprioritize."* — listed in the menu, one toasted on load.
- **Filter** (top left) — color *is* the category: four toggleable swatches (red, blue, yellow, white) plus a "Show completed" chip, any mix at once. A filtered-out block rests as open space — the composition keeps its shape, and the block is inert until its color returns.
- **Clear completed** — turns every white ✓ block into open space in one tap.

## Storage

`localStorage` keys: `mond.tree` (the full split tree, tasks embedded), `mond.vis` (which colors are visible), `mond.struct`, `mond.seen` (first-run intro), `mond.v` (schema version — bumping it wipes stale data on next load). The day starts as one uninterrupted block of open space, with an onboarding card explaining the gestures; clear the keys to reset. (Pre-filter `mond.layers` data is folded into the single composition on first load.)

## Not implemented (from the mock)

Long-press quick menu (tap-inspect covers it) and due *times* (dates only). The mock's layers were replaced by the color filter — one day, one composition.
