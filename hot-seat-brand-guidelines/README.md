# Hot Seat — Brand Guidelines

The official visual identity for **Hot Seat**, a retro-style trivia/elimination game show. This folder is a self-contained, GitHub-ready brand package: design tokens, final art assets, and reference graphic templates, built from the original design handoff and made screen-size-agnostic so it works everywhere the brand shows up — the live game app, broadcast-style overlays, social graphics — not just one fixed canvas.

```
hot-seat-brand-guidelines/
├── README.md              ← this file
├── tokens/
│   ├── colors.css         ← the full color system
│   ├── typography.css     ← fonts + fluid type scale
│   └── patterns.css       ← the stage-background + vignette system
├── assets/                ← final art: logo, chair emblem, pattern tiles
└── examples/               ← 4 reference graphics built from the tokens
```

Drop `tokens/` and `assets/` into any project, link the three CSS files, and build from the classes and custom properties documented below.

---

## 1. Logo

Three approved executions of the wordmark, each for a different context. Never redraw or re-set the wordmark in a different typeface — always use one of these.

| Asset | File | Use it when… |
|---|---|---|
| White cutout | `assets/hotseat-logotext.png` | Sitting on a photo, video, or any busy/colored background — the soft drop shadow keeps it legible over anything. |
| Solid ember | `assets/hotseat-logotext-ember.png` | Sitting on a flat light background (stage gold, cream). This is the primary version for title cards and print. |
| Live text (CSS) | fill `var(--cream)`, `-webkit-text-stroke` in `var(--ember)` | Anywhere you need the wordmark to be actual selectable/scalable text instead of an image — e.g. a compact badge or UI header. See `examples/social-avatar.html`. |

**The chair emblem** (`assets/hotseat-chair.svg`) is the one custom icon in the system — a flaming armchair. It already appears baked into the wordmark (replacing the "O" in HOT), and also stands alone as a badge/favicon element. It's a normal scalable SVG — recolor only in the two approved states (full color as shipped, or a single flat `var(--ember)` silhouette). Never squash its aspect ratio.

**Clear space & minimum size:** keep clear space around the wordmark equal to the height of the "T" in SEAT on every side. Don't shrink the full wordmark below ~120px wide (it stops reading at a glance below that) — use the chair emblem alone as a favicon/tiny-badge substitute instead of shrinking the full lockup.

**Don't:**
- Don't recolor the wordmark to anything outside `var(--cream)` / `var(--ember)` / plain white.
- Don't place the white-cutout version on a light background (it disappears) or the ember version on a dark/busy background (it loses contrast) — match the asset to the surface per the table above.
- Don't stretch, skew, or add your own drop shadow/outline on top of the pre-built ones.

---

## 2. Color

The original handoff defined more color tokens than were actually used anywhere — two different, unrelated "golds" among them. This system consolidates that down to what's proven in real use, organized as one coherent gold ramp instead of disconnected values. Full file: [`tokens/colors.css`](tokens/colors.css).

### Stage colors
One full-bleed background per graphic type — pick the one that matches the content, never mix:

| Token | Hex | Used for |
|---|---|---|
| `--stage-gold` | `#FFF931` | Show open / title art, badges, default/neutral stage |
| `--stage-green` | `#206243` | Contestant / people-focused graphics (lower thirds) |
| `--stage-maroon` | `#622030` | Category / segment cards |

### Gold accents
Small doses on top of a stage color — bars, rules, labels. Never a full background on their own.

| Token | Hex | Used for |
|---|---|---|
| `--gold-label` | `#FFDD33` | Small caption/eyebrow text sitting on a dark panel |
| `--gold-accent` | `#FFC400` | Accent bars, underlines, dividers |

### Ember
The brand's primary ink — outlines, the wordmark tint, the one recurring "brand color" that shows up regardless of which stage color is behind it.

| Token | Hex | Used for |
|---|---|---|
| `--ember` | `#7F1515` | Primary accent, outlines, wordmark tint, script accent text |
| `--ember-soft` | `#A62348` | Hover/active state only — never a resting background |

### Neutrals
| Token | Hex | Used for |
|---|---|---|
| `--cream` | `#FFFBF2` | Text/logo fill on any stage color |
| `--ink` | `#241506` | Text/plate fill on gold |

**Rule of thumb:** every graphic is *one stage color* + *cream or ink text* + *ember or gold-accent for the one detail that should pop*. If you find yourself reaching for a fourth color, you're probably overcomplicating it.

---

## 3. Typography

Three typefaces, each with one job. Full file: [`tokens/typography.css`](tokens/typography.css).

| Font | Role |
|---|---|
| **Alfa Slab One** (`--font-display`) | Hero wordmarks and titles. It's already a heavy/black-weight face — don't apply `font-weight`, it does nothing and just wastes a declaration. |
| **Oswald** (`--font-heading` / `--font-body`) | Everything else: labels, eyebrows, captions, UI body text. |
| **Pacifico** (`--font-script`) | The one script accent line ("tonight, someone's in the…"). Sparing use only — never body text, never more than one line on a graphic. |

### Fluid type scale

Every size token is a `clamp()`, so a graphic built from these holds its proportions from a phone screen up through a 1920×1080 broadcast canvas instead of being locked to one resolution. This is a deliberate change from the original handoff, where every template hand-set one-off pixel values tuned only for a fixed 1920px canvas — that doesn't hold up once the same graphic needs to render at other sizes.

| Token | Role |
|---|---|
| `--text-display-xl` | Largest hero title (e.g. a category card's title) |
| `--text-display-lg` | Secondary hero text (e.g. a lower-third name, an avatar wordmark) |
| `--text-display-md` | Small display text |
| `--text-heading-lg` / `--text-heading-md` | Tag lines, location lines, UI headings |
| `--text-eyebrow` | Small caption labels ("CATEGORY", "CONTESTANT") |
| `--text-body-lg` / `--text-body-md` | UI body copy (not for broadcast graphics) |
| `--text-script-accent` | The one Pacifico accent line |

Use the whole shorthand token directly: `font: var(--text-display-xl);`.

---

## 4. Stage pattern & vignette

Every graphic sits on a tiled flame pattern that fades to a flat panel color at the edges (the vignette). This is one reusable system, not four separate implementations — see [`tokens/patterns.css`](tokens/patterns.css).

```html
<div class="hs-stage hs-stage--gold" style="aspect-ratio:16/9;">
  <!-- your content -->
</div>
```

- `.hs-stage` sets up the layering (pattern behind, vignette on top of that, your content on top of both).
- Add exactly one modifier: `.hs-stage--gold`, `.hs-stage--green`, or `.hs-stage--maroon`. Each one wires up the matching pattern SVG and panel color together, so you can't accidentally pair the wrong tile with the wrong background.
- Add `.hs-stage--circle` for square/badge formats (uses a circular vignette instead of elliptical — see `examples/social-avatar.html`).
- The pattern tile size is `clamp(160px, 22vw, 420px)` — it scales with the container instead of one fixed 420px tile, so the pattern reads at a sane density whether the graphic is 300px or 3000px wide.

**Source tiles:** `hotseat-pattern-gold-tile.svg`, `-green-tile.svg`, `-maroon-tile.svg` — pre-baked, tone-on-tone, tileable at any size. `hotseat-pattern-original.svg` is the first draft (gold-on-gold) and is kept in `assets/` for reference only — don't use it in new work, it's superseded by the three tone-matched tiles.

---

## 5. Graphic templates

Four reference graphics, each a real working HTML file in `examples/` — open any of them directly in a browser. Each one is built responsively (an `aspect-ratio` frame + fluid units), not pinned to 1920×1080, so treat the HTML as the pattern to follow rather than a fixed canvas to copy pixel-for-pixel.

| Template | Stage | Structure |
|---|---|---|
| `title-card.html` | Gold | Centered column: script accent line → wordmark → chair icon + tag line |
| `lower-third.html` | Green | Bottom-left name plate: gold accent bar + dark panel with name (display) + location (label) |
| `category-card.html` | Maroon | Centered column: eyebrow label → big two-line title → gold underline rule |
| `social-avatar.html` | Gold, circular vignette | 1:1, centered chair icon + live-text wordmark with ember stroke at the bottom |

All four share the same recipe: one `.hs-stage` frame, fluid type tokens, and layout done with flexbox + `clamp()` spacing instead of fixed pixel offsets. Building a new graphic type? Start by copying whichever of these four is structurally closest and swap the content.

---

## 6. What changed from the original handoff

For traceability — the original design files live in the `design_handoff_hot_seat_brand` folder this was built from, untouched, as the source-of-truth reference for the visual decisions themselves (exact colors, fonts, asset content). This package changes *how it's organized and implemented*, not the actual design:

- **Colors consolidated.** The original `colors.css` defined 16 tokens plus 3 more exact hex values used only inline in the templates (19 total), but only about 8 of those were ever actually used anywhere. Unused speculative tokens (a full teal scale, several unused ember/gold/cream/ink shades) were dropped, and the two disconnected golds (`#FFF931` used only inline, `#FFC400`/`#FFDD33` from the token file) were reorganized into one coherent, named system: *stage* colors vs. *accent* colors.
- **Social avatar's background fixed.** The original `social-avatar.html` referenced a `hotseat-pattern-ember.png` file that doesn't exist anywhere in the handoff, and used a different gold than the other three templates. It now uses the same gold tile + `--stage-gold` as the title card, matching the handoff README's own written description of the intent.
- **Typography made fluid.** The original type tokens (`typography.css`) were never actually used by any of the 4 templates — each one hand-set custom pixel sizes tuned only for a 1920×1080 canvas, several well outside the token file's own defined range. The scale here is rebuilt as `clamp()`-based fluid tokens so one set of sizes works at any screen size, and the templates now actually consume the tokens instead of overriding them inline.
- **Templates rebuilt responsively.** The original 4 templates were fixed 1920×1080 pixel canvases (`width:1920px;transform:scale(0.36..)`), meant to be recreated per-target rather than used directly (per the original README). The versions here use `aspect-ratio` frames and fluid spacing so they render correctly at any size without a rebuild.

## 7. Open items

- The original handoff mentions a fuller brand voice/tone document at the root of "the main project" that wasn't included in this bundle. If that surfaces, fold it into a "Voice & Tone" section here.
- The live game app currently uses its own separate palette/logo, not this system yet — aligning it is a deliberate follow-up, not part of this pass.
