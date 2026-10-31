# Nexus — Navigation, Layout & Workflow Redesign: Assessment and Proposal

Status: **proposal for review. No code has been changed.** Branch `staging`, based on commit `9ce0eb0`.
Facts below come from the code and a read-only query of `nexus-staging`. Anything I did not check is marked **(not checked)**.

---

## 1. Assessment of the current application

### 1.1 Navigation today: four overlapping systems
| Layer | What it shows | Problem |
|---|---|---|
| Sidebar (`app/modules.ts`) | Dashboard, Projects, Fleet, **7 disabled "coming soon" items** (Assets, Workforce, Documents, Operations, Quality, Analytics, plus Procurement), Procurement, Data & backups | Most entries are placeholders. Procurement appears here and again inside each project. |
| Phone bottom nav (`app/primaryNav.ts`) | Overview, Construction, Crew, Fleet, Safety | Different taxonomy from the sidebar. |
| Project tab row (`ProjectLayout`) | Overview, Foundations, Materials, Procurement, Pours, Fabrication, Anchorage, Handover, Fleet (9 tabs) | Mixes monitoring, editing, configuration and Fleet in one row. |
| Area tabs (`AreaPage`) | Overview, Register, Construction, Materials, Quality, Handover | A second tab row. Materials appears here as well. |

Plus a sidebar "Areas" shortcut list.

Concrete consequences:
- **Materials has six entry points:** global `/procurement`, project Materials, Material records, project Procurement, the Area Materials tab, and the Foundation Materials section. They now agree on numbers (Phase 1), but a user still has to know which one to open.
- **A foundation can only be reached through its Area** (`/projects/:p/areas/:a/foundations/:f`). There is no foundation selector and no way to jump straight to one.
- **Project Fleet is nested inside a project** (`/projects/:p/fleet`) and also exists globally (`/fleet`).
- **Monitoring and editing are mixed.** The Area Overview, Construction tab and Foundation page all read progress and also edit it.
- **Several tabs are demo-only** and hidden in server mode: Fabrication, Handover, and parts of the legacy bolt flows.

### 1.2 What the data model can and cannot represent
Verified in `types.ts`, `config.ts`, `blankActivities.ts` and migrations `0001` and `0018`:

1. **Progress is stored per foundation designation, not per physical footing.**
   - `Activity` is keyed `foundationId:key` (footing scope) or `plinthId:key` (plinth scope).
   - `Foundation.quantity` is only a count. There is no record that says "footing 3 of 6 is formed".
   - Your example, "12 of 18 footings formed", **cannot be recorded today**. A designation is formed or it is not.
   - `foundation_units` (A-1, A-2…) exists but is optional and carries only a label and embed plates, with no progress.
2. **Civil / Earthworks does not exist.** Activity categories today are `materials`, `rebar`, `construction`, `survey` and `qaqc`.
3. **Rebar** (built and installed) is a real category not in your list. It is currently counted inside Construction progress.
4. **"Anchor bolts installed" is not recorded.** The `anchorBolts` activity is derived from material allocation (readiness). The installation indicator already states: "Anchor bolt installation is not recorded." Material *installations* (migration `0017`) are per requirement, not per foundation.
5. **No "Not applicable" status.** Applicability is implicit: the model creates an activity where it applies.
6. **"Not yet recorded" is indistinguishable from "Not started".** Only recorded activities are stored (96 rows today). A missing row is displayed as Not started.
7. **Survey and QA/QC are already separate records** (`category: 'survey' | 'qaqc'`, statuses `work` / `qaqc`). Completing a construction activity does not set them. This part of your requirement is already satisfied, and the redesign must keep it that way.
8. **Permissions are coarse.** Roles are viewer / editor / admin (`shared/rbac.ts`). `updateActivity` needs `data.edit`, so there is no per-discipline permission. Server enforcement already exists and is the right base.
9. **No bulk activity command.** The server registry exposes only `updateActivity`.
10. **Activity history:** the idempotent `change_log` records every command. I did not find a reader that shows a per-activity history **(not checked in the UI)**.
11. **Two progress calculations exist.** `progressOf` (average of rebar, forming and pouring, as equal thirds) and `packageProgress.ts` (four indicators). They overlap and use different rules.
12. **Crew, Safety and Data pages** exist as modules **(their contents not checked)**.

### 1.3 Staging data (read-only query)
2 projects · 5 areas · **28 foundation designations = 96 physical footings** (11 designations have quantity > 1) · 53 plinths · **0 individual-foundation (unit) rows** · 96 recorded activities · 0 pours · 1 role row.

Meaning: per-footing tracking matters for 11 of the 28 designations, and nobody has entered footing identifiers yet, so adding numbered footings loses nothing.

---

## 2. Proposed page and navigation architecture

### 2.1 Frame
Header: logo · **Project selector** · four primary sections · user menu.
Phone: bottom bar with the same four items, with the project selector in the top bar.

| Section | Needs project? | Route |
|---|---|---|
| **Progress** | yes | `/p/:project/progress/…` |
| **Manage** | yes | `/p/:project/manage/…` |
| **Foundation** | yes | `/p/:project/foundation/…` |
| **Fleet** | no | `/fleet/…` |

The last project is remembered, and `/` opens it. With one project there is no picker screen. Crew, Safety, Data & backups and project configuration move to an overflow menu (**More**) so nothing is removed.

The 7 "coming soon" sidebar placeholders are dropped from the navigation. This is a decision for you (see section 8).

### 2.2 Route tree
```
/                                         → last project's Progress (or project picker)
/p/:project/progress                      Project overview: area cards
/p/:project/progress/:area                Area dashboard: 5 category cards
/p/:project/progress/:area/:category      Category: activities / materials with required · done · outstanding · %
/p/:project/progress/:area/:category/:activity   Items (foundations) with status → link to Foundation
/p/:project/manage/materials              Requirements · Orders · Deliveries (existing workspace)
/p/:project/manage/construction           Activity workspace (list | blocks)
/p/:project/manage/survey                 same component, survey activities
/p/:project/manage/qaqc                   same component
/p/:project/manage/civil                  same component
/p/:project/foundation                    Selector: Area → Designation → Footing
/p/:project/foundation/:designation       Aggregate lifecycle
/p/:project/foundation/:designation/:footing   One physical footing
/p/:project/setup/…                       Configuration (see 2.4): foundations, areas, anchorage library, pours
/fleet/…                                  Existing Fleet, unchanged internally
```
Existing URLs (`/projects/:p/areas/:a/foundations/:f`, `/procurement`, `/projects/:p/materials`, …) become **redirects**, so bookmarks and in-app links keep working.

### 2.3 Reuse over duplication
- One `ProgressModel` (section 5) feeds all three views, the same pattern as the Phase 1 `materialsModel`.
- One `ActivityWorkspace` component serves Construction, Survey, QA/QC and Civil, parameterized by category.
- One `ProgressBar`, `StatusBadge`, `CategoryCard` and drill-down link component serve every screen.
- A progress figure is always a link to the records behind it (area → category → activity → foundation).

### 2.4 Configuration is kept, just relocated
Foundation creation and editing, Anchorage Library, areas, pour planning, anchorage types, suppliers and access management move under **More → Setup** (admin-gated exactly as today), with contextual "Edit configuration" links from the Foundation page and Manage → Materials.

---

## 3. Mapping existing features to the new structure

| Existing | Becomes | Action |
|---|---|---|
| Dashboard `/` and Project overview | Progress → Project overview | rebuild on ProgressModel; keep issues panel |
| Areas / Area Overview tab | Progress → Area dashboard | rebuild |
| Area → Construction tab | Progress → Category + Manage → Construction | split into view and edit |
| Area → Quality tab | Progress → Survey / QA/QC + Manage → Survey / QA/QC | split |
| Area → Materials tab, Material records | Progress → Materials (read); Manage → Materials (edit) | relocate |
| Materials, Procurement (project + global) | Manage → Materials & Procurement (Requirements · Orders · Deliveries) | **relocate as is; no logic change** |
| Foundation page (`FoundationPage`) | Foundation → Lifecycle | extend (adds footing level, civil, per-step detail) |
| Foundation Register | Foundation selector + Setup → Foundations | split |
| Add / Edit Foundation, foundation configuration | Setup → Foundations | relocate, same modals |
| Anchorage types, Anchorage Library | Setup → Anchorage | relocate |
| Pours, Pour planner | Manage → Construction → Pours | relocate |
| Individual foundations (units) | Foundation → footing level | extend |
| Issues | Progress → Needs attention (existing panel) | keep |
| Fabrication, Handover | unchanged, demo-only | stay hidden in server mode **(decision: keep or retire later)** |
| Fleet (global + project) | Fleet | merge into one place; internals untouched |
| Crew, Safety, Data & backups | More menu | relocate |

New components needed: project selector and context, ProgressModel, category and activity drill-down pages, ActivityWorkspace (list/blocks/bulk), footing-level lifecycle view, shared progress components.

---

## 4. The three primary workflows

**A. "How is the project progressing?" (Progress, read-only).**
```
Project: Pad A ▾            Overall 54%  (as of today)
┌ E-House ──────────┐ ┌ Mole Sieve ───────┐ ┌ Propane BOG ──────┐
│ 61%  ███████░░░░  │ │ 48%               │ │ 40%               │
│ 14 footings left  │ │ …                 │ │ …                 │
│ Mat 70 Con 55 Sur │ │                   │ │                   │
│ QA 40 Civ —       │ └───────────────────┘ └───────────────────┘
└───────────────────┘
E-House → Construction → Footing formed   12 / 18  67%  outstanding 6
   OP1-01-01 A-1 ✓ · A-2 ✓ · A-3 in progress · … → opens Foundation
```
Every number is a link. No edit controls. Viewers see this section fully.

**B. "What needs updating?" (Manage, by discipline).**
Pick a category, then filter Area and Foundation. Rows are activities × footings, shown as a list or blocks. Select several, then **Set status / date / note**. Each cell shows Not started · In progress · Complete · N/A and its date. A history drawer reads the change log. Edit controls appear only if the role allows, and the server rejects the command otherwise.

**C. "What is this foundation's full status?" (Foundation).**
Selector: Area → Designation → Footing (or "All footings"). The dashboard shows designation, area, footing count, dimensions and concrete, anchorage types, overall %, current stage and outstanding work. Five category panels each list their steps with status, date and supporting detail. The Materials panel shows four separate lines per material: **required → ordered (project) → delivered (project) → allocated (this foundation) → installed**, so a bulk delivery is never shown as "this foundation has it".

---

## 5. Recommended progress calculation

Principle: only count what is recorded, never assume, show the numbers behind every percentage.

**Unit of work.** An activity instance on a physical item: one footing, or one plinth on one footing. A designation with quantity 6 and 2 plinths per foundation has 6 footing instances and 12 plinth instances.

**Statuses** (shown consistently everywhere):
| Status | Counts as done | In denominator |
|---|---|---|
| Not applicable | no | **no** |
| Not yet recorded | no | yes, and flagged "not recorded" |
| Not started | no | yes |
| In progress / pending review | no | yes |
| Completed / approved | **yes** | yes |

Blocked is a flag on Not started or In progress, not a separate outcome.

**Formulas**
1. **Activity %** = completed instances ÷ applicable instances. Example: 12 of 18 → 67%.
2. **Physical footing %** = completed milestones ÷ applicable milestones for that footing.
3. **Designation (foundation group) %** = pooled completed ÷ applicable instances across its footings and plinths (counting instances, not averaging averages).
4. **Construction, Survey, QA/QC and Civil category %** = mean of their activities' %, each activity weighted equally (each is a distinct milestone).
5. **Materials category %** = mean over requirement lines of min(delivered ÷ required, 1). Ordered, delivered, outstanding and allocated quantities are always displayed beside it. Today's headline counts only lines delivered in full, and I propose changing to quantity-based so partial deliveries show progress.
6. **Area %** and **Project %** = mean of the applicable categories (equal weight), always displayed with the five category figures. A category with no applicable work is excluded, not counted as 0 or 100.
7. Missing data is never shown as complete: a category with nothing recorded shows "Not recorded", not 0% or 100%.

No category weights are invented: weights are equal, stated on screen, and the alternatives are in section 8. Rebar stays inside Construction (as today).

`progressOf` and `packageProgress.ts` would be replaced by this single model, with oracle tests like Phase 1.

---

## 6. Missing data models and functionality

All additive; no existing row is rewritten.

1. **Per-footing progress.** Add a nullable `unit_no` to `activities` (migration `0024`). A null value is today's designation-level record. Rules to avoid contradiction: a designation-level record applies to every footing that has no footing-level record of its own, and a footing-level record overrides it. Footings are the implicit numbers 1..quantity, with the optional label from `foundation_units` when set. A `setFootingActivities` batch command writes them.
2. **Civil / Earthworks.** New category `civil` with definitions for Initial grading, Excavation, Gradework prior to pour, Backfill (names and order need your confirmation). Rows are created lazily, so no backfill is needed.
3. **Not applicable status**, added to the status sets, and a way to mark an activity N/A per footing.
4. **Anchor bolts installed** as a real recorded footing/plinth activity, separate from material readiness.
5. **Batch update commands** for activities, with a single change-log entry per bulk action and the existing optimistic versioning.
6. **Discipline permissions:** `activity.construction`, `activity.survey`, `activity.qaqc`, `activity.civil`. The server maps `updateActivity` to the right one by the activity's category. Editors keep all four, so current behavior is unchanged. Per-user assignment can come later.
7. **Activity history reader** over the existing change log.
8. **Selectors and ProgressModel** as the single calculation, with tests.

---

## 7. Phased implementation roadmap
Each phase is committed to `staging` only after tests pass, and I will not deploy structural changes until you approve this plan.

| Phase | Scope | Data change |
|---|---|---|
| **0** | Your decisions (section 8) | none |
| **1** | Navigation shell: project context, four sections, redirects from old URLs, phone bottom bar, More menu. Existing pages mounted unchanged under the new routes. | none |
| **2** | ProgressModel (calculation engine, designation-level data first, instance-aware) with oracle tests and agreement checks against Materials and Procurement | none |
| **3** | Data foundation: migration `0024` (`unit_no`), Civil definitions, Not applicable, anchor bolts installed, batch commands, discipline permissions, server and client tests | **additive migration** |
| **4** | Progress dashboards: project, area, category, activity drill-down | none |
| **5** | Manage workspaces: Materials & Procurement relocation; ActivityWorkspace for Construction, Survey, QA/QC, Civil with bulk update and history | none |
| **6** | Foundation Overview: selector, designation and footing lifecycle, materials chain | none |
| **7** | Fleet navigation consistency, Setup area, responsive QA (desktop, iPad, phone), full regression | none |

Phases 1 and 2 are independent of the migration and carry the least risk, so they come first.

---

## 8. Risks, dependencies and decisions needing your approval

**Decisions**
1. **Per-footing model:** implicit footings numbered 1..quantity (with optional labels), plus the override rule in section 6.1. Alternative: require individual-foundation labels first. *Recommended: the implicit numbering.*
2. **How legacy designation-level "complete" is read:** as applying to every footing without its own record. This keeps current data meaning unchanged but means footing detail starts equal across a designation until someone records it.
3. **Headline Area/Project %:** equal-weight mean of applicable categories. Alternatives: pooled count of all milestone instances, or admin-configurable weights later.
4. **Materials %:** switch from "lines delivered in full" to quantity-based (capped). Changes figures people already see.
5. **Civil activity list and order**, and whether it is footing-scope only.
6. **CM03 / CM04:** are they just the labels for pre-pour and post-pour inspection (what I assume), or separate documents tracked separately from inspections?
7. **Navigation clean-up:** drop the 7 placeholder modules; move Crew, Safety and Data & backups to More; keep Fabrication and Handover hidden in server mode.
8. **Discipline permissions:** add the four permissions now (editors keep all), or defer.
9. **Rebar:** keep under Construction (my recommendation) or give it its own category.

**Risks**
- **Redirects and bookmarks:** every old path must redirect. Mitigation: a route-parity test over all current paths.
- **Figures will change** where the new rules differ from `progressOf`/`packageProgress` (notably Materials % and Area %). I will list old vs new figures for staging before release.
- **Per-footing override rule** is the subtlest logic; it gets dedicated tests (designation record vs footing record, quantity changes, plinths per footing changes).
- **Quantity edits:** lowering a designation's quantity below recorded footing numbers must be refused or archived, not deleted.
- **Scale:** the audit's H4 scalability concern grows with per-footing rows (96 footings now; thousands of instances later). The ProgressModel will be memoized like `procurementRows`.
- **Permissions:** hiding buttons is not enough, so each new command is tested against viewer/editor/admin on the server.
- **Browser verification:** I cannot reach the staging host from this session. I will test locally with Playwright (desktop, iPad and phone widths) and will not claim a staging deployment check.
- **Not reviewed:** the Crew and Safety pages and Fabrication/Handover contents, which I only mapped by route.

**Dependencies:** your answers to section 8, then Phase 1 can start immediately; Phases 3 onward need decisions 1, 2, 5 and 6.
