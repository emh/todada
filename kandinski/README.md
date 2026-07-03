# Kandinski / Todo

> This is not a list. It is a composition.

A todo app in harmony: your day is a living composition and **every task is a geometric element** with weight, color, direction, and relation. You bring balance to your day by arranging what matters. Based on `mocks/kandinski-ux.png`. Vanilla JS, no build step — serve the repo root and open `/kandinski/`.

## The language

Everything about an element means something:

| Property | Encodes |
|---|---|
| **Color** | Context — purple creative, blue work, yellow personal, red urgent, green health, gray someday |
| **Shape** | Type of work — point (quick action), circle (open-ended), square (focused), triangle (decision), line (routine), curve (flow), dots (exploratory) |
| **Size** | Effort / time (set by your gesture) |
| **Position** | When / importance |
| **Proximity** | Relationship |

High-priority elements carry a dashed halo. The background is a soft watercolor wash, generated per tone.

## Gestures

| Gesture | Effect |
|---|---|
| **Tap** empty canvas | Add a point task |
| **Drag** on empty canvas | Create a shape task — the motion becomes the element: a straight stroke suggests a *line*, a bent one a *curve* (your actual path is kept as the shape), a closed loop a *circle*. Length sets size, direction sets orientation |
| **Tap** an element | Focus it: subtasks, due date, weight, layer, color, shape |
| **Slow drag** | Move it (groups move together) |
| **Flick** | Resolve it — the element drifts off in your flick direction and fades into the background as a ghost. Undo via toast |
| **Lasso** (dashed-circle button) | Circle elements to relate them |

## Features

- **Name & intent** — after a gesture, name the element and choose its color (context) and shape (type); the inferred shape is pre-selected. The **+** button places an element at the quietest spot on the canvas.
- **Subtasks** — each element can hold steps with checkboxes and inline add.
- **Groups** — related elements get a dashed ellipse with thin connecting lines and drag as one composition.
- **Balance** — the app senses visual balance: it computes the composition's center of mass and dispersion, overlays the crosshair and weight marker, and gives a verdict (*"Off balance. Too much pressure on the right."*, *"Scattered. Losing focus."*, *"Balanced. Good flow."*). **Harmonize** gently animates every element until the weight settles at center.
- **Focus** — dims everything except the elements that pull the day (high weight or due by tomorrow).
- **Daily palette** — what kind of day is this? Calm & Clear, Structured, Creative Flow, Deep Focus, High Energy, Restorative — the background washes adapt (Structured adds a faint grid).
- **Layers** (bottom bar) — Today, Work, Personal, Health, Someday, Completed with show/hide eyes; any mix can be visible.
- **Smart notices** — spoken in the composition's own language: *"The blue square is due tomorrow."*, *"2 tasks are drifting to the edges."*, *"Your composition is almost balanced."*

## Storage

`localStorage` keys: `kand.tasks` (including drawn curve paths), `kand.vis`, `kand.tone`, `kand.color`, `kand.seen` (first-run intro), `kand.v` (schema version — bumping it wipes stale data on next load). The app starts as an empty composition with an onboarding card explaining the gestures; clear the keys to reset it.

## Not implemented (from the mock)

Pinch zoom & two-finger pan, new-layer creation, and the link/sequence/nest relation variants (lasso grouping covers the core).
