# Mobile design system

Nexus has one codebase and one set of data and business logic. A **phone presentation** changes how that same state is shown on small
screens; tablets and desktops keep the existing layout (sidebar, top bar, tables, right-hand panels).

## What is a "phone"

`(max-width: 767.98px), (max-height: 500px) and (pointer: coarse)`: phones in portrait, and phones in landscape (short, touch). The query
lives in two places that must match, and a test enforces it: the `phone:` Tailwind variant in `src/index.css` and `PHONE_QUERY` in
`src/lib/useMedia.ts`. Use `phone:` classes for pure styling and `useIsPhone()` when the *structure* differs (cards instead of a table).

## Shell (`src/layout`)

| Piece | Behaviour |
| --- | --- |
| `MobileHeader` | Sticky, safe-area aware. Top level: Nexus mark + organization. Detail screens: back arrow, title, and the project as context. Search button when the screen has a `[data-search]` field. Menu button. "Demo" pill in the public demo. |
| `BottomNav` | Fixed, five destinations (`src/app/primaryNav.ts`): Overview, Construction, Crew, Fleet, Safety. Active tab highlighted. A project's Fleet belongs to Fleet. Compact in landscape. |
| `MoreSheet` | Secondary navigation, planned modules, where the data lives, and (public demo) Demo Environment + Reset Demo. |
| `AppShell` | Phone: the page scrolls as a normal document (Safari's toolbar collapses) with 5.5rem + safe-area clearance for the bottom bar. Otherwise the original sidebar/top bar. |

Safe areas: `viewport-fit=cover` (index.html) and `env(safe-area-inset-*)` on the header, bottom bar, sheets and page gutters.

## Scale and touch targets (`src/index.css`, phone only)

Body 16px · row text 15 · supporting text 13 · labels 12 · page title 28 · section titles 18 · gutters 16px. Every button, tab, summary,
menu item and stand-alone link is ≥ 44px tall; form fields are 16px (no iOS focus-zoom) and 44px tall. The scale is applied to the
existing utility classes, so every screen inherits it without per-page overrides.

## Shared mobile components (`src/components/mobile`, `src/components/ui`)

* **Card tables.** `table.card-table` becomes stacked cards on phones; `labelCardTables` copies each column header onto its cells, so every
  column, input, link and handler keeps working (nothing is removed or duplicated). Used by the generic tables.
* **Bespoke cards** where the content deserves it: projects, fleet assets, foundation/plinth register, package progress, vehicle gauges.
* `MeterBar`, `SortBar`, `Segmented`, `ChipTabs` (horizontal chip tabs: an intentional scroll area), `BottomSheet`.
* **Modal** is a right-hand panel on desktop/tablet and a full-screen sheet on phones with a large close button and a floating primary action.
* **Stat rows** (`<dl>` holding `.t-metric`) become summary cards by structure.
* **Gauges** use the shared `RadialGauge` in a horizontal "row" layout on phones.

## Crew and Safety

New phone destinations built only from records that already exist (no new stored data): **Crew** from crews, people and the rotation anchor
(14 on / 7 off); **Safety** from fleet inspections/defects (verified only) and construction deficiencies, using the existing commands.

## Public demo and staging

Nothing here calls an API or touches D1; the demo bundle guard, browser-local storage and Reset Demo are unchanged (docs/DEPLOYMENT.md).

## Checking a change

Run the app, then at 320, 375, 390, 430, 768, 1024 and 1440 px (and 844×390 landscape) confirm: no horizontal page scroll, no text under
12px on phones, controls ≥ 44px, nothing hidden by the bottom bar, forms open as sheets. The unit tests cover navigation, the CSS contract
and the query match.
