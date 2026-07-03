# Todada

Todo-app experiments in art-driven UX. Vanilla JS, mobile-first, no build step.

Serve the repo root (`python3 -m http.server 4173`) and open:

| App | Path | The idea |
|---|---|---|
| **Todada** | `/` | The main list app — one DOM, six visual designs (Basquiat, Bauhaus, Brutalist, Kandinsky, Mondrian, Pollock) switchable at runtime via a CSS-token theme system |
| **Pollock / Todo** | [`/pollock/`](pollock/README.md) | Tasks are paint splatters you throw onto a canvas — tap, flick, or press-and-hold; scrub to smear complete |
| **Basquiat / Todo** | [`/basquiat/`](basquiat/README.md) | Tasks are marks you literally draw, crowned by priority (KING → GHOST); slash to cross out, lasso to build a crew |
| **Kandinski / Todo** | [`/kandinski/`](kandinski/README.md) | Tasks are geometric elements in a composition — the gesture becomes the shape; flick to resolve, harmonize to balance |
| **Mondrian / Todo** | [`/mondrian/`](mondrian/README.md) | The screen is the list — a grid where every rectangle is a task; splitting adds, white restores calm |

The design mocks each app was built from live in [`mocks/`](mocks/).

Each experiment starts as a blank canvas with a first-run onboarding card (in the artist's own voice) explaining the gestures, and persists everything to its own `localStorage` namespace — clear the keys (listed in each README) to reset.
