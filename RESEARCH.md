# Research: where Go apps fail beginners, and how Tengen can be better

Research conducted June 2026 across the App Store, r/baduk / online-go forums,
Quora, and Go-teaching writeups. Sources are linked at the bottom.

## 1. The current App Store landscape

| App | What it is | Strengths | Where it falls short for beginners |
|---|---|---|---|
| **BadukPop** | The most-recommended beginner app. 4,000+ tsumego, tiered AI, lessons, ratings. | Genuinely beatable AI ladder; you can *learn while playing*; huge problem set. | Lessons/puzzles **don't explain *why*** a group lives or dies; online ratings feel disconnected from real strength; online play frustrates people. |
| **SmartGo One** | Powerful study/play app (KataGo engine, hints, SGF recording/annotation). | Very strong engine; great for review and serious study. | Reads as a **study tool, not a friendly first game**; depth is intimidating to a true beginner. |
| **Tsumego Pro** | Life-and-death problem trainer. | Focused, good spaced practice. | Problems only — no play, no onboarding. |
| **PVGo** | AI tutor (GNU Go) that gives step-by-step hints. | Hand-holding hints while you play. | Dated engine/feel; still assumes you grasp the goal. |
| **Legend of Baduk** (Korea Baduk Assoc.) | Gamified, stage-clearing path to ~15-kyu. | **Gamification works** — clearing stages keeps people moving. | Newer/regional; the genre-leading idea (stages) is the takeaway. |
| **igowin / Many Faces of Go** | Classic 9×9 with **adaptive handicap** that shrinks as you win. | The adaptive-handicap loop is the single best beginner mechanic ever shipped. | Old UI; not modern-mobile. |
| **OGS / KGS** | Online servers. | Real opponents, communities. | Matchmaking + clunky mobile UX; a cliff for absolute beginners. |

**Takeaway:** the genre has strong *content* (problems, engines) but weak
*first-hour experience*. The best ideas are scattered across different apps —
nobody has combined adaptive handicap + gamified onboarding + a board that
actually *explains itself*.

## 2. What beginners actually struggle with (the real pain points)

From forum threads, Quora answers, and teaching writeups, the recurring blockers:

1. **The goal is invisible.** The #1 barrier isn't the rules (which are tiny) —
   it's that *"who is winning / what is territory"* is **abstract and impossible
   to see** without it being drawn for you. Counting feels like homework.
2. **Life & death is opaque.** Beginners can't tell which groups are alive or
   dead, and apps "save" or "kill" groups during scoring **without explaining
   why** — the single most common BadukPop complaint.
3. **The 19×19 board is overwhelming.** Teachers universally start people on
   9×9/13×13. Many apps still drop beginners onto a full board.
4. **The tutorial→real-game cliff.** Lessons feel safe; the first real game
   feels like freefall with no feedback and no sense of progress.
5. **Opponents are mismatched.** AI is often too strong with no gentle ramp;
   online ratings feel meaningless; getting crushed kills motivation.
6. **Scoring at the end is confusing.** Dead-stone removal and "who won" is a
   mystery ritual.
7. **(Mobile-specific) fat-finger misplacement.** Tapping a 19×19 grid on glass
   puts stones on the wrong point — a top mobile complaint across board games.

## 3. Design opportunities → what makes Tengen better & more fun

Each opportunity maps to a pain point above.

- **Make the invisible visible — a live territory heatmap.** (→ #1, #6) Toggle a
  Bouzy-style influence overlay that shades the board by who controls what, with
  a running score estimate. The abstract goal becomes a picture you can read at
  a glance. *Built in v0.*
- **Atari & danger warnings.** (→ #2) Groups down to one liberty pulse. You
  *feel* tension and learn the concept by seeing it, not reading it. *Built.*
- **Tap-to-confirm with a ghost stone.** (→ #7) Aim with a translucent preview,
  nudge it to the exact point, then commit with a big button. No misfires.
  *Built.*
- **Gentle, adaptive opponent.** (→ #5) Three friendly levels now; next, an
  igowin-style **handicap that shrinks as you win** so games stay close and
  winnable. *Levels built; adaptive handicap is roadmap.*
- **Small boards first.** (→ #3) 9×9 is the default. *Built.*
- **A guided scoring flow.** (→ #6) Tap dead groups, watch territory fill in
  with animation, then a clear "Black wins by 17.5." *Built.*
- **"Why?" explanations.** (→ #2, #4) Roadmap: tap any group to get a plain-
  language read ("this group has two eyes — it's alive"); after a capture,
  explain the atari that led to it. This directly fixes the biggest content gap
  in the category.
- **A gamified learn path.** (→ #4) Roadmap: start with **Capture Go / Atari Go**
  (first to capture wins) — the proven, low-pressure on-ramp — then graduate to
  real games with stage-clearing momentum.
- **Make it feel like a toy you want to touch.** (→ motivation) Tactile sound,
  haptics, capture "pops", physical-button presses. Joy is retention.

## 4. Build plan

**v0 — playable prototype (this commit).** Correct rules engine, 9/13/19 boards,
pass-&-play + gentle AI, territory heatmap, atari warnings, tap-to-confirm,
undo/hint, scoring flow, the full aesthetic, sound + haptics, installable PWA.

**v1 — the friendly first hour.**
- Capture-Go onboarding mode + a 5-screen "how Go works" interactive intro.
- "Why?" group inspector (eyes / liberties / alive-dead read in plain words).
- Adaptive-handicap bot (handicap shrinks as you win).
- Move-by-move review with the heatmap as a scrubber.

**v2 — depth & stickiness.**
- Daily tsumego with spaced repetition; a gentle stage-clearing ladder.
- Local profiles + rank estimate that *explains itself*.
- Stronger engine option (WASM KataGo-lite) for players who graduate.
- Online / async play with friends.

**Stretch.**
- Generated dithered "board skins" and theme palettes in the low-tech style.
- Apple Pencil / haptic refinements; Dynamic Island live-score on iPhone.

## Sources

- BadukPop — App Store & site: https://apps.apple.com/us/app/badukpop-go/id1472684271 · https://badukpop.com/
- SmartGo One vs BadukPop usage: https://www.similarweb.com/app/apple/1472684271/vs/1465746992/
- PVGo (AI tutor): https://apps.apple.com/us/app/pvgo-weiqi-go-baduk-learning/id1475583944
- Legend of Baduk (KBA) — online-go forum: https://forums.online-go.com/t/new-go-app-for-beginners-from-kba-legend-of-baduk/57331
- "Best baduk apps" roundup: https://appshunter.io/ios/topics/baduk
- Beginner difficulty / counting / board size — Quora: https://www.quora.com/Is-Go-a-hard-game-to-learn · BBO forum: https://www.bridgebase.com/forums/topic/72896-learning-go-weiqi-baduk/
- App/web recommendations incl. igowin adaptive handicap: https://www.quora.com/What-app-or-web-do-you-recommend-for-play-Baduk-go-Weiqi-I-would-like-begin-to-play-seriously
- Counting territory (why it's hard): https://mysanrensei.wordpress.com/2014/12/28/lecture-video-how-to-count-territory/
