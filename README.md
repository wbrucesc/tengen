# Tengen — Go, made friendly

A mobile-first, beginner-first version of the ancient game of **Go** (Baduk /
Weiqi), with a low-tech dithered look and chunky, tactile "analog" controls.

> **Tengen** (天元) is the centre point of the Go board — the origin.

This repo currently holds a **working v0 prototype** you can smoke-test on a
phone. It is a zero-dependency static web app: no build step, no framework, no
server. Open `index.html` and play.

- 📄 [`RESEARCH.md`](RESEARCH.md) — what's already on the App Store, what
  beginners actually struggle with, and the design opportunities that informed
  this build.
- 🎨 [`DESIGN.md`](DESIGN.md) — the visual system (low-tech dither × teenage
  engineering EP-40) and the interaction principles.

## What works in v0

- Full, correct **Go rules engine** — captures, suicide rule, **positional
  superko**, two-pass end, Chinese (area) scoring. (Headless-tested.)
- **Capture Go on-ramp** — a "first to capture a stone wins" mode (the proven
  way to teach Go in five minutes), plus the full **territory** game.
- **9×9 / 13×13 / 19×19** boards. 9×9 is the default beginner on-ramp.
- **Pass & play** (two humans) or **vs computer** at three gentle levels.
- **Teaching hints** — the Hint button suggests a move *and explains why*
  ("this puts a group in atari — it threatens to capture next turn").
- Beginner aids that most apps lack:
  - **Live territory heatmap** — toggle it to *see* whose ground is whose, with
    a running "Black +3.5 / White +6.5" estimate. (Territory is the #1 thing
    beginners can't see.)
  - **Atari warnings** — groups with one liberty left pulse orange.
  - **Tap-to-confirm** placement with a ghost stone + magnified aim, so you
    never fumble a stone onto the wrong point.
  - **Undo** and **Hint**.
- **End-game scoring flow** — tap dead groups to remove them, watch the
  territory fill in, see who won.
- **Feel**: click/clack sounds (Web Audio), haptic taps (Vibration API),
  capture "pops", and physical-button press animations.
- **Installable PWA** — "Add to Home Screen" on iOS for a full-screen,
  offline-capable app.

## Smoke-test it on your iPhone

**Option A — GitHub Pages (recommended, gives a shareable URL):**

1. In this repo: **Settings → Pages → Build and deployment → Source:
   "GitHub Actions"**.
2. The included workflow (`.github/workflows/deploy.yml`) publishes on every
   push to this branch. Open the resulting URL in **Safari** on your iPhone 17
   Pro.
3. Tap the **Share** icon → **Add to Home Screen** for the full app feel.

   > Pages on a *private* repo requires GitHub Pro/Team. If the repo is on the
   > Free plan, either make it public temporarily for testing, or use Option B.

**Option B — run it locally / on any host:** it's plain static files, so any
static server works:

```bash
python3 -m http.server 8000   # then open http://<your-computer-ip>:8000 on the phone (same Wi-Fi)
```

(Use a server rather than `file://` so the ES modules and service worker load.)

## Project layout

```
index.html              app shell + screens
styles.css              the whole aesthetic
js/engine.js            pure Go rules: groups, captures, ko, scoring, influence
js/ai.js                gentle heuristic opponent
js/app.js               canvas rendering, touch input, sound, UI wiring
manifest.webmanifest    PWA metadata
sw.js                   offline cache
icons/icon.svg          app icon
```

## Roadmap

See the "Build plan" section of [`RESEARCH.md`](RESEARCH.md). Near-term: a
gamified **learn path** (Capture Go → first real games), per-move "why was that
group dead?" explanations, and an adaptive-handicap bot that shrinks the
handicap as you improve.
