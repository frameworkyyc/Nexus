# Nexus visual design system

Large, immediately readable operational indicators; minimal chrome; detail on demand. Everything shown is derived from recorded
data. Where data is missing the UI says **Unknown** (never a placeholder number or a half-filled ring).

## Status colours (one vocabulary everywhere)

| Status | Colour | Meaning | Glyph |
| --- | --- | --- | --- |
| `ok` | green | confirmed healthy / inside a recorded threshold | check |
| `warn` | orange | approaching a threshold / attention soon | triangle |
| `bad` | red | overdue / critical | octagon |
| `unknown` | grey | not enough recorded data | question mark |
| `info` | blue | neutral information, no judgement | i |

Colour is never the only signal: every status has a distinct glyph and a text label. Tokens live in `src/index.css`
(`--nx-ok`, `--nx-warn`, `--nx-bad`, `--nx-unknown`, `--nx-info`, `--nx-track`); logic in `src/components/viz/status.ts`.
Incomplete construction progress is `info`, not red, unless it is behind a recorded schedule or target.

## Components (`src/components/viz`)

| Component | Use |
| --- | --- |
| `RadialGauge` | Large ring with a centred figure, status mark and detail lines. Arc only when `percent` is a number; unknown = dashed empty track. Optional click-through (`onSelect` / `to`) and quick actions. |
| `StatusMark` | Glyph + label for any status. |
| `MetricSummary` | Borderless big number with label, optional status, sparkline and click-through. |
| `UnknownState` | The intentional "no data" block with the reason and an optional action. |
| `MaintenanceAlerts` | Worst-first list of things that need attention; renders nothing when empty. |
| `Sparkline` | Trend line from two or more recorded points; nothing otherwise. |
| `Donut` (`components/ui`) | Plain progress ring built on the same maths (neutral blue by default). |

Pure rules (unit-tested): `ringFraction`, `ringGeometry`, `intervalConsumed` (needs start, end and current), `remainingStatus`
(green only with a recorded warning window; blue when none; orange inside the window; red when past due), `worstStatus`.

## Vehicle dashboard rules (`src/domains/fleet/indicators.ts`)

* **Scheduled service** – remaining km from the latest valid odometer and the next *non-oil* service target. Percentage only when the
  last completed service of the same recorded type gives a known interval start.
* **Oil change** – separate schedule: a service target whose recorded type is an oil change. An untyped "next service" is never
  read as one. Last change = latest completed maintenance of that type. Percentage only with both the last-change odometer and the
  next-change odometer. A schedule at or below the last completed oil change is treated as done (next change "not set").
* **Tires** – status rests, in order, on a recorded condition, a measured tread vs. a recorded replacement threshold, or a
  configured expected lifespan. Distance or age alone is never green. No default lifespan exists.
* **Weekly inspection** – cadence only (current < 7 days, due at 7, overdue after). Never says the vehicle is healthy; unreviewed
  submissions show "awaiting review"; open defects are listed (no severity is recorded, so they are orange, not red).
* **Accessories** – inventory tiles, not lifespan indicators.

## Where else the system applies

Redesigned: Fleet → vehicle dashboard (T6010 and every vehicle), `Donut` (package progress). Still to do, in suggested order:
organization/project Fleet tables (status glyphs, an attention roll-up), construction area overview and Foundation register
(`ProgressBar` → ring/segment summaries), Materials (ordered / received / outstanding as stacked meters), Installation, Survey and
QA/QC when those modules exist.
