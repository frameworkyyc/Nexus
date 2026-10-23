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

## Rings (one primitive, everywhere)

`Ring` (`src/components/viz/Ring.tsx`) is the only thing that draws a circular indicator. `RadialGauge` (Fleet) and `Donut` (Construction:
Materials, Installation, Survey, QA/QC) are thin layouts over it, so size (`RING_SIZE` 176), stroke (6% of size), track colour,
typography (figure = 20% of size, status words 14%) and direction are identical. It is a smooth full-circle track plus one solid arc:
no dashes, dots or segments. The arc starts at 12 o'clock and runs clockwise.

* **Percentage gauge** – arc = the percentage.
* **Status-only gauge** (e.g. weekly inspection) – no arc; the track is faintly tinted with the status colour.
* **Unknown** – a plain grey track and the word Unknown.

## Components (`src/components/viz`)

| Component | Use |
| --- | --- |
| `Ring`, `RingValue` | The shared rendering primitive and its centred figure. |
| `RadialGauge` | Ring + title, status mark, short detail and optional click-through / quick actions. |
| `StatusMark` | Glyph + label for any status. |
| `MetricSummary` | Borderless big number with label, optional status, sparkline and click-through. |
| `UnknownState` | The intentional "no data" block with the reason and an optional action. |
| `MaintenanceAlerts` | Worst-first list of things that need attention; renders nothing when empty. |
| `Sparkline` | Trend line from two or more recorded points; nothing otherwise. |
| `Donut` (`components/ui`) | Plain progress ring (neutral blue by default) for construction packages. |

Pure rules (unit-tested): `ringFraction`, `ringGeometry`, `intervalConsumed` (needs start, end and current), `remainingStatus`
(green only with a recorded warning window; blue when none; orange inside the window; red when past due), `worstStatus`.

## Vehicle dashboard rules (`src/domains/fleet/indicators.ts`)

Four primary gauges, each configurable per vehicle and each showing the **remaining** share as its arc:

* **Vehicle Lifespan** – `Vehicle.expectedLifeKm` (planning estimate). Remaining % = (estimate − odometer) / estimate, clamped 0–100;
  green inside the estimate, orange (planning flag, never red) beyond it. It never changes condition or serviceability.
* **Oil Change** – the one oil-change schedule: a service target whose recorded type is an oil change, with optional `intervalKm` and
  `warnWithinKm`. Interval start = the last completed oil change (when its odometer is known) else due − interval, a *calculated
  baseline* that is never turned into a maintenance record. Remaining % = km left / interval. Green outside the warning window,
  orange inside it, red overdue, blue when no window is configured. Completing an oil change (any odometer above the interval start)
  retires the target; recording the next mileage (prefilled as last + interval) updates the gauge. Other services keep their own target
  and appear as an extra gauge only when one exists.
* **Tire Lifespan** – `TireSet.expectedLifeKm` (estimated, mileage-based) from distance on the active set. Kept separate from recorded
  condition, which stays Not assessed until an inspection or tread measurement. Red only for a recorded replace condition or tread at or
  below the recorded limit.
* **Weekly Inspection** – status only, from **genuine** inspections (interval = `Vehicle.inspectionIntervalDays`, default 7): current,
  due, overdue, or Unknown. Never says the vehicle is healthy. Demonstration records (`InspectionRecord.demo`) are labelled
  "Demo / Unverified", cannot be reviewed or carry defects, are ignored by status, condition and defects, and are removed with
  one action without touching genuine history.

## Where else the system applies

Redesigned: Fleet → vehicle dashboard (every vehicle), construction package rings (Materials, Installation, Survey, QA/QC). Still to do, in suggested order:
organization/project Fleet tables (status glyphs, an attention roll-up), construction area overview and Foundation register
(`ProgressBar` → ring/segment summaries), Materials (ordered / received / outstanding as stacked meters), Installation, Survey and
QA/QC when those modules exist.
