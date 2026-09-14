# Design Tokens — Direction 3: Modern / Analytical (Dashboard-Led)

## Colors

| Token | Hex | Role |
|---|---|---|
| `color-brand-navy` | `#224D95` | Logo, primary links, active states, chart primary series |
| `color-surface-dark` | `#12151C` | Hero / dark surfaces |
| `color-surface-light` | `#F5F6F8` | Light page backgrounds (dashboards, data pages) |
| `color-surface-white` | `#FFFFFF` | Cards, panels, content surfaces on light pages |
| `color-accent` | `#1F8A82` | CTAs, interactive elements, active chart series, links on dark background |
| `color-text-secondary` | `#8A909C` | Captions, labels, secondary stats |

### Data-visualization categorical palette
Use for multi-series charts. Kept distinct from the UI accent so charts don't compete with interface elements.

| Token | Hex |
|---|---|
| `dataviz-1` | `#224D95` (navy) |
| `dataviz-2` | `#1F8A82` (teal) |
| `dataviz-3` | `#8E5BA6` (violet) |
| `dataviz-4` | `#C99A2E` (amber) |
| `dataviz-5` | `#D9695A` (coral) |
| `dataviz-6` | `#8A909C` (gray) |

## Typography

- **Family:** Sans-serif grotesk (e.g. Inter, or a comparable system grotesk) used for everything — headlines, body, UI chrome, chart labels. No serif in this direction; that's the main distinction from the editorial direction.
- **Hierarchy:** Carried by weight and size, not by switching typefaces.
  - Headlines: bold / 700 weight, tight letter-spacing (~ -0.01em)
  - Body copy: lighter weight for contrast against headlines
- **Numerals/stats:** Same family, tabular figures, so numbers align cleanly in stat/dashboard cards.

## Component notes

- **Buttons:** Teal (`color-accent`) fill, near-black (`color-surface-dark`) text, small border-radius (~4px)
- **Stat cards:** White surface on `color-surface-light` background; bold numeral with a small gray (`color-text-secondary`) caption underneath
- **Charts/bars:** Rounded top corners only; colors drawn from the data-visualization categorical palette above, not from UI accent colors

## Semantic colors

Used for directional and status indicators (up/down, risk levels). Reuses existing tokens where possible to avoid palette sprawl; adds two new tokens only where no existing color fits.

| Meaning | Token | Hex | Source |
|---|---|---|---|
| Positive / increase | `semantic-positive` | `#2F9E58` | New — true green, distinct in hue from the teal accent so "clickable" and "good" aren't confused |
| Negative / decrease | `semantic-negative` | `#D9695A` | Reused — `dataviz-5` coral |
| Neutral / no change | `semantic-neutral` | `#8A909C` | Reused — `color-text-secondary` |
| Caution / warning | `semantic-warning` | `#C99A2E` | Reused — `dataviz-4` amber |
| Critical / high risk | `semantic-critical` | `#A83226` | New — deeper, more saturated red reserved for the top severity tier only |

**Accessibility rule:** never rely on color alone to carry semantic meaning. Pair every semantic color with a shape or symbol (▲/▼, +/−, or an icon), so status remains legible for colorblind users and in grayscale report printouts.
