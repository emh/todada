# Basquiat / Todo

> Not just tasks. Thoughts. Reminders. Visions. Marks to become king.
> Not organized. Not perfect. But real.

A todo app for the chaos and the genius: your day is a scrawled canvas and **every task is a hand-made mark** — you literally draw it. Based on `mocks/basquiat-ux.png`. Vanilla JS, no build step — serve the repo root and open `/basquiat/`.

## The canvas

Tasks render as rough painted blocks (jittered edges, Permanent Marker titles) surrounded by seeded decorations — underlines, loose frames, arrows, stray X's — on paper covered in faint background scrawl. If you drew something when creating the task, **your strokes are kept and rendered as part of the mark**.

**Shape detection** — draw a box, a circle, or a crown and the app recognizes it (*"A BOX. I'LL SQUARE IT UP."*): the shape is cleaned up (still hand-jittered), **filled solid with a complementary color**, and becomes the mark itself with the title inside. Any other *closed* scribble keeps your exact strokes but gets filled too. Outline color = your pen; fill defaults to its complement (black→yellow, yellow→red, red→blue, blue→white) and both are editable from the mark's inspect panel — the fill palette swaps white in for black. **The fill color is also the mark's category/layer** (open scribbles carry one too, it just isn't painted).

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
| **Tap** a mark | Open it: crown, outline & fill colors, due date, notes, cross out, erase |
| **Fast swipe** across a mark | Slash it — live ink follows your finger, then the mark gets scribbled X'd out and goes ghost. It stays as history. Undo via toast |
| **Slow drag** | Move the mark (crews move together) |
| **Two-finger drag / scroll wheel** | Scroll the canvas — it starts three screens tall and **grows on demand**: keep pulling past the bottom edge and another screen is added. Empty trailing screens fall away on the next load |
| **Pinch in** (trackpad pinch or double-click empty canvas) | Zoom out to see the whole canvas; **tap where you want to go** to dive back in |
| **Lasso** (dashed-circle button) | Circle marks to build a crew — they stack into a pile |

## Features

- **The crown system** — six priorities: KING (must do), QUEEN (important), BISHOP (soon), KNIGHT (if I can), PAWN (someday), GHOST (let it go). Higher crowns render bigger with gold crowns; pawns and ghosts shrink and fade.
- **Crews** — lasso marks and they **stack into a pile** with a scrawled blue ring and a member count. A stacked crew drags as one and a **fast swipe slashes the whole crew**. Tap the stack to spread it out — spread members act individually (slash one, move one, tap to inspect). Tap inside the ring to stack them again; lassoing a crew together with other marks grows the crew. Dissolve via BREAK UP (toast on spread) or "Leave crew" (inspect).
- **Focus** (☰) — the fill color *is* the category: four round swatches (white, red, blue, yellow), tap to toggle — a highlighted ring means visible. Any combination can be on at once, each a different mood, world, or context.
- **Smart notices** — guidance, not alerts: *"2 red marks are overdue."*, *"Your crown is leaning left."*, *"Don't forget your idea with the yellow square."* Listed in the crown sheet; one toasts on load.
- **The Day sheet** (crown button) — notices (*"All quiet. The crown rests."* when there are none), **SAVE IMAGE** (exports the whole canvas as a PNG), and **ARCHIVE DAY** (stores the crossed-out ghosts and clears them).
- **Notes** — every mark holds freeform notes. Fragments. Whatever.

## Storage

`localStorage` keys: `basq.tasks` (including your raw stroke paths), `basq.pen`, `basq.vis` (which fill colors are visible), `basq.crews` (stack state & anchors), `basq.archive`, `basq.seen` (first-run intro), `basq.wv` (y-coordinate migration flag — y is stored in viewport heights so the canvas can grow without moving marks), `basq.v` (schema version — bumping it wipes stale data on next load). The app starts as a blank canvas with an onboarding card explaining the gestures; clear the keys to reset it.

## Not implemented (from the mock)

Shake-to-scatter — device-motion territory. (Pinch-zoom overview and two-finger pan are in.)
