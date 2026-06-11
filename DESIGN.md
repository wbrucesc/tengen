# Design system: low-tech dither × EP-40 riddim

Two references drive the look:

1. **Low-Tech Magazine's solar site** — its images are **dithered** (reduced to a
   limited, grainy, duotone palette). The compression artifacts *are* the
   aesthetic: warm, printed, tactile, deliberately "different." The standout
   reference image ("too much combustion, too little time") is a warm
   **amber/orange duotone** on cream. The site is otherwise minimal: off-white
   paper, dark ink, default typefaces, no logo clutter.
2. **teenage engineering EP-40 riddim** — palette of **orange + cream + dark
   green**, hand-painted/DIY signage energy, injection-molded plastic with
   **pad-printed, chunky, dimensional buttons**. Playful, quirky, "toy-like in
   the best way," but precise.

Tengen fuses them: a **cream printed-paper field**, **combustion-orange** as the
primary action color, **deep green** as the secondary, **ink** for stones and
lines — all under a subtle **dither/grain overlay**, with controls that look and
feel like **physical keys**.

## Palette

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#efe7d3` | app background (printed paper) |
| `--paper-2` | `#e7dcc2` | cards / panels |
| `--board` | `#e4d2a8` | board field |
| `--ink` | `#211e18` | lines, text, black stones |
| `--cream` | `#f4eeda` | white stones, button labels |
| `--orange` | `#df5b25` | primary action / combustion accent |
| `--orange-d` | `#a83c12` | orange button "side" (3D shadow) |
| `--green` | `#1f4a3a` | secondary action / active toggles |
| `--green-d` | `#133023` | green button "side" |

## Texture

A fixed full-screen **grain overlay** (`.grain`) uses an inline SVG
`feTurbulence` fractal noise at `mix-blend-mode: multiply`, ~0.5 opacity. This
gives every surface the dithered, printed-on-paper grain without shipping image
assets. Stones use a soft radial gradient so they read as physical glass/slate
beads, each with a hard offset drop-shadow for dimension.

> Roadmap: a true ordered-dithering pass (Bayer / Floyd–Steinberg) for any
> photographic content and generated "board skins," matching the Low-Tech look
> exactly.

## The analog button (the "quirky dimension")

Every `.btn` is a physical key:

- 2px ink border, flat fill, and a **hard `box-shadow: 0 5px 0 <side-color>`** —
  the colored "side" of the key, no blur. That single trick creates the chunky
  EP-40 dimensionality.
- On `:active` the key **translates down 5px and the shadow collapses to 0** — it
  physically depresses. Paired with a haptic tap and a click sound, pressing
  feels real.
- Primary keys are orange, secondary green, neutral cream. Selected chips invert
  to ink-on-cream. Labels are monospace (the pad-printed look) with tiny
  sub-labels.

## Interaction principles

- **Make the invisible visible.** Territory, influence, atari, last move, and
  score estimate are all *drawn*, never left as mental math.
- **No misfires.** Placement is aim-then-confirm by default; the confirm key
  glows and nudges when a stone is pending.
- **Reward the touch.** Sound + haptics + capture "pops" on every meaningful
  action. The board should feel alive and a little playful.
- **Calm by default, depth on demand.** Beginner aids are toggles — the board is
  clean unless you ask for help.

## Typography & layout

System monospace stack (`ui-monospace, SF Mono, Menlo…`) for the utilitarian,
pad-printed, low-tech character with zero web-font weight. Single-column,
thumb-reachable layout; big bottom action row; safe-area insets for the iPhone
notch/Dynamic Island.
