# Happy Hour design

## Overview

This is a single-page fee monitor and transaction interface for people using the ETH/HAPY test pool. A warm paper background, dark text, serif headings and a restrained terracotta accent support the daily schedule. The clock is the first data surface. The donation panel is the main action; the swap panel is secondary. Technical provenance and donation details use native disclosure controls.

This file is under `docs/` because root-level writes are prohibited by the assignment. It documents the actual source, principally `web/src/style.css` and `web/src/App.tsx`.

## Colors

The semantic aliases in `style.css` are the reuse points. Primitive values are used through those aliases in components.

| Semantic token | Value / primitive | Use |
| --- | --- | --- |
| `--color-bg` | `--cream-50`: `#f8f5ed` | Page, neutral inset surfaces |
| `--color-surface` | `#fffdf7` | Cards, controls |
| `--color-text` | `--ink-900`: `#292d29` | Body, data, headings |
| `--color-muted` | `--ink-500`: `#5f6259` | Supporting text |
| `--color-border` | `--cream-200`: `#ddd7ca` | Structural borders |
| `--color-accent` | `--orange-600`: `#b63f22` | Main donation button, brand/hero emphasis |
| `--color-accent-hover` | `--orange-700`: `#98341d` | Donation hover |
| `--color-warm` | `--orange-100`: `#f8e7ce` | Clock panel, network notice |
| `--color-success` | `--green-700`: `#3e6048` | Live-state dot, paired with text |
| `--color-error` | `--red-700`: `#963721` | Error text on `#f9e8df` |
| `--color-focus` | `#174d92` | Keyboard focus perimeter |

`--cream-100: #eee9df` supports neutral hover/disabled backgrounds. ETH's currency icon uses `#e9e9f0` and `#4d5065`; currency labels also identify assets in text. There is one light theme. Contrast measurements and automated checks are recorded in validation; no dark theme is implied.

## Typography

- Body and controls: `Arial, Helvetica, sans-serif`; 16px root, 1.5 line height. Supporting UI text uses the `.small-text` role, 13px/1.6, with 11–12px auxiliary balance/source captions.
- Main headings: `Georgia, 'Times New Roman', serif`; regular 400, with the second hero line italic. H1 uses `clamp(3.5rem, 6.7vw, 5.8rem)`, 1.02 line height, and −0.035em tracking. On the narrowest breakpoint it is 3.25rem. H2 is 1.8rem/1.2; mobile cards use 1.7rem. H3 is 1rem, semibold sans-serif.
- `.eyebrow` uses uppercase presentation, 600 weight and 0.14em tracking. Text is stored in natural case. Clock-panel labels are 10px and decorative schedule labels can be 10px; body descriptions and controls remain larger.
- Changing amounts, clock and countdown use `.numerals` with tabular figures. Balance values wrap when necessary and expose complete precision via their title; donation review and quote minima display exact amounts. All deployment IDs remain fully readable in the disclosure.
- Inputs are at least 16px, with the amount field at 1.6rem. Headings use balanced wrapping, prose uses pretty wrapping and a 70-character measure. Long hashes and transaction errors allow wrapping.

There are no downloaded fonts or font network requests. Font appearance follows the local system's available serif/sans-serif stack; no specific proprietary face is required.

## Layout

`.wrap` caps content at 1200px with 40px horizontal padding. Spacing primarily uses 8px multiples: 16/24/32/40/48/64px. The 8px `--space` token documents the base step; individual rules use explicit values.

The desktop clock is a three-column grid. The action grid is `1.35fr 1fr` with a 24px gap and top-aligned panels. Supporting explanation is three columns. DOM order matches reading order: header, introduction, clock/schedule, connection/feedback, donation, swap, activity, explanation, provenance, footer.

At 60rem, page/card padding and gaps tighten; the action grid becomes `1.15fr 1fr`. At 46rem, action/explanation grids become one column and the clock moves above the fee/countdown pair. The decorative sun stamp disappears. Header/footer wrap; full addresses wrap in details. At 24rem, page padding is 16px and card padding is 20px. No sticky overlay obscures actions. Safe viewport scaling is left enabled.

Rendered evidence covers 1440, 768, 390 and 320 CSS pixels, including horizontal overflow checks, plus 200% text enlargement. Native browser zoom, physical devices and RTL/localized layouts were not tested; English is the implemented language.

## Elevation & Depth

The page is deliberately flat. Borders describe card/input boundaries and event rows. Only the selected swap-direction button has a subtle `0 1px 3px #292d291c` shadow. The clock panel is distinguished by its warm fill. Native disclosure sections avoid modal layering.

## Shapes

The shared panel radius is `--radius: 16px`. Buttons, form fields, segment groups, error notices and review insets use 8px corners. Currency icons and the decorative action arrow are circular. Focus is a 3px solid outline with 4px offset; forced-colors mode retains system rendering.

## Components

`App.tsx` implements patterns rather than an exported component library:

- `Sun`: inline decorative SVG, 116px or 43px small variant, inherited stroke color and hidden from assistive technology. No raster or external icon dependency.
- Wallet area: named native controls, optional connector selector, full address in deployment details, compact disconnect control, and a separate visible wrong-network action.
- Clock panel: explicit UTC label, block number, last-observed/live language, stable-width digits and fee-period text. Ticking values are intentionally not live-announced every second.
- Donation panel: separate asset balances, the sole accent-filled primary button, disabled reasons, inline review and cancel/confirm actions, and native details for LP allocation/JIT behavior.
- Swap form: explicit buy/sell toggle buttons using `aria-pressed`, visible amount/slippage labels, linked invalid-input feedback, exact minimum output, bounded approval steps and expiry messaging.
- Feedback: stable polite transaction-status region plus alert region, placed before the action cards. Signing errors scroll this area into view; input validation focuses the relevant enabled field. A transaction explorer link remains available after submission.
- Activity list: event type, amount/currency, block/transaction link; empty and failed-read states are distinct. Provenance uses a native details/summary and definition list.

Controls have explicit disabled, hover, focus, pressed, loading and error behavior. Typical buttons are at least 46px high; compact buttons are 42px. Direction buttons are 36px with padded groups. Interactive transitions use 120ms `ease-out` for background/transform, gated by `prefers-reduced-motion: no-preference`; pressed buttons scale to 0.96. No page entrance or perpetual animation exists.

## Do’s and Don’ts

Reuse semantic colors, native controls, shared panel/control radii and the same hierarchy. Keep exact currency units and block provenance next to data. Use the donation accent sparingly. Leave full addresses and exact transaction amounts accessible. Preserve text labels for status and decorative-icon alternatives.

Do not introduce a second runtime deployment map, hide stale data behind a live label, estimate real pool balances, reduce mobile input text below 16px, or rely on colors alone. New flows should preserve transaction simulation, explicit spending steps and disabled prerequisites.

## References

Applied the supplied Better Interface guide by Jakub Krehel (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`). Documentation structure follows Paul Bakaus’s Impeccable method (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). These attributions identify reference methods, not third-party authorship of this implementation.
