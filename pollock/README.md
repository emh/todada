# Pollock / Todo

> Tasks are not rows. They are energy. Throw them on the canvas.

A todo app where your day is a drip-painting canvas and **every task is a paint splatter**. Based on `mocks/pollock-ux.png`. Vanilla JS, no build step — serve the repo root and open `/pollock/`.

## The canvas

Each mark is a task, drawn procedurally (seeded per task, so splatters are stable across reloads). The paint encodes meaning:

| Color  | Meaning                 |
|--------|-------------------------|
| Black  | High impact             |
| Red    | Urgent / time sensitive |
| Blue   | Work / projects         |
| Yellow | Quick / small           |
| Gray   | Done / past             |

Size and spread come from the energy of the gesture that created the mark. The paper texture itself is generated per session and adapts to your mood setting.

## Gestures

| Gesture | Effect |
|---|---|
| **Tap** empty canvas | Drop a small, quick task |
| **Press & hold** | A growing ink preview; longer hold = bigger, more "thoughtful" mark |
| **Flick** | Throw a high-energy task — the splatter elongates in the flick direction, with streaks, and lands past your release point |
| **Tap** a mark | Inspect: rename, recolor, set due date, smear done, delete |
| **Drag** a mark | Move it (position is yours to compose) |
| **Scrub** back-and-forth over a mark | Smear it complete — it snaps back, shakes, and redraws as a gray/white dry-brush scrape with a faint color ghost. Undo via toast |
| **Two-finger drag / scroll wheel** | Scroll the canvas — it starts three screens tall and **grows on demand**: keep pulling past the bottom edge and another screen is added. Empty trailing screens fall away on the next load |

## Features

- **Name-it bubble** — after a throw, a speech bubble appears over the fresh mark; naming it commits the task, cancelling dissolves the paint.
- **Focus** (☰) — the color *is* the category: five round swatches (black, red, blue, yellow, and gray for smeared marks), tap to toggle — a highlighted ring means visible. Any combination can be on at once; "Scrape off smeared marks" clears the gray history.
- **Daily setup** (◎) — "What kind of day is this?" Controlled, Chaotic, Heavy, Sparse, Frantic, or Clear. The mood multiplies the energy of new marks and regenerates the paper grain.
- **Poetic notices** — heuristics fire toasts like *"The canvas is getting heavy."*, *"The center is crowded."*, *"3 marks are bleeding into tomorrow."* (once per session each).
- **Completed marks stay** — smears remain on the canvas as history rather than disappearing.

## Storage

`localStorage` keys: `pollock.tasks` (x is a width fraction, y is in viewport heights so the canvas can grow without moving marks), `pollock.vis` (which colors are visible), `pollock.ink`, `pollock.mood`, `pollock.seen` (first-run intro), `pollock.v` (schema version — bumping it wipes stale data on next load). The app starts as a blank canvas with an onboarding card explaining the gestures; clear the keys to reset it.

## Not implemented (from the mock)

Pinch-to-zoom into clusters, lasso clustering, and shake-to-scatter. (Two-finger pan and the grow-on-demand canvas are in.)
