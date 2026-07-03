# Basquiat / Todo

> Not just tasks. Thoughts. Reminders. Visions. Marks to become king.
> Not organized. Not perfect. But real.

A todo app for the chaos and the genius: your day is a scrawled canvas and **every task is a hand-made mark** — you literally draw it. Based on `mocks/basquiat-ux.png`. Vanilla JS, no build step — serve the repo root and open `/basquiat/`.

## The canvas

Tasks render as rough painted blocks (jittered edges, Permanent Marker titles) surrounded by seeded decorations — underlines, loose frames, arrows, stray X's — on paper covered in faint background scrawl. If you drew something when creating the task, **your strokes are kept and rendered as part of the mark**.

| Color  | Meaning          |
|--------|------------------|
| Black  | Major / focus    |
| Red    | Urgent / fire    |
| Blue   | Work / projects  |
| Yellow | Ideas / maybe    |
| White  | Done / ghosts    |

## Gestures

| Gesture | Effect |
|---|---|
| **+** then **draw** | Make a mark: scribble a box, a line, a crown, whatever you feel (multi-stroke, pen color picker), then "GIVE IT VOICE" — name it in big marker text |
| **Tap** a mark | Open it: crown, layer, color, due date, notes, cross out, erase |
| **Fast swipe** across a mark | Slash it — live ink follows your finger, then the mark gets scribbled X'd out and goes ghost. It stays as history. Undo via toast |
| **Slow drag** | Move the mark (crews move together) |
| **Lasso** (dashed-circle button) | Circle marks to build a crew |

## Features

- **The crown system** — six priorities: KING (must do), QUEEN (important), BISHOP (soon), KNIGHT (if I can), PAWN (someday), GHOST (let it go). Higher crowns render bigger with gold crowns; pawns and ghosts shrink and fade.
- **Crews** — lassoed marks get a scrawled blue ring and drag as one. Tap inside a ring to break it up, or "Leave crew" from inspect.
- **Layers** (☰) — Today, Work, Personal, Ideas, Waiting, Done with **show/hide eyes** — any combination can be visible at once, each a different mood, world, or context.
- **Smart notices** — guidance, not alerts: *"2 red marks are overdue."*, *"Your crown is leaning left."*, *"Don't forget your idea with the yellow square."* Listed in the crown sheet; one toasts on load.
- **The Day sheet** (crown button) — notices, the color palette legend, **SAVE IMAGE** (exports the whole canvas as a PNG), and **ARCHIVE DAY** (stores the crossed-out ghosts and clears them).
- **Notes** — every mark holds freeform notes. Fragments. Whatever.

## Storage

`localStorage` keys: `basq.tasks` (including your raw stroke paths), `basq.pen`, `basq.vis`, `basq.archive`, `basq.seen` (first-run intro), `basq.v` (schema version — bumping it wipes stale data on next load). The app starts as a blank canvas with an onboarding card explaining the gestures; clear the keys to reset it.

## Not implemented (from the mock)

Pinch zoom & pan, and shake-to-scatter — multi-touch / device-motion territory.
