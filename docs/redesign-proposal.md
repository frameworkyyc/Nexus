# Nexus — Navigation & Materials Redesign (Revised, Materials-first scope)

Status: **proposal for review. No code has been changed.** Branch `staging`.
This revision replaces the earlier all-disciplines proposal. Facts come from the code and a read-only query of `nexus-staging`; anything not checked is marked **(not checked)**.

## 0. Scope of this phase

**In scope**
- The new four-section navigation and layout (Project Progress, Project Management, Foundation Overview, Fleet).
- New Materials & Procurement functionality in all three project views, built on the unified Materials model from Phase 1.
- The five discipline categories visible in the right places.

**Explicitly out of scope (nothing in these areas changes)**
- Individual physical footing tracking and any migration for it.
- New Civil / Earthworks activities.
- New Survey or QA/QC workflows.
- Construction activity changes.
- Discipline-specific permissions.
- New overall project progress calculations or category weighting.

**Rules for the other four categories**
- Where records and pages already exist (Construction/Installation, Survey, QA/QC), they are kept and reused unchanged. They are relocated or embedded, never replaced by a placeholder.
- Where nothing exists (Civil / Earthworks, and anything in the five-category layout with no data source), the space shows a clearly labelled **"Future development"** placeholder, not an empty page and not an invented number.
- No database migration is needed for this phase. Materials already has everything it needs in the Phase 1 model.

---

## 1. Current state (relevant findings)

- Four overlapping navigation systems: sidebar (with 7 disabled "coming soon" items), phone bottom bar (different items), a 9-tab project row, and a second tab row inside each Area.
- Materials has six entry points: global `/procurement`, project Materials, Material records, project Procurement, the Area Materials tab, and the Foundation Materials section.
- A foundation can only be reached through its Area; there is no foundation selector.
- Procurement today has two tabs, Requirements and Orders. Deliveries are recorded from requirements or orders; allocations and installations live in the requirement dialog; history and import/export live on the separate "Material records" page.
- Construction, Survey and QA/QC already exist as the Area "Construction" and "Quality" tabs and the Foundation activity table. Only recorded activities are stored (96 rows on staging). Civil does not exist.
- Staging: 2 projects, 5 areas, 28 foundation designations (96 physical footings), 53 plinths, 0 individual-foundation rows.
- Roles are viewer / editor / admin, enforced on the server per command (`shared/rbac.ts`). All materials commands already have their own permissions (add, edit, receive, bulk, void-receipt, archive, configure). This is kept as it is.

---

## 2. Revised navigation structure

### 2.1 Frame
Header (desktop and iPad): logo · **Project selector** · **Project Progress · Project Management · Foundation Overview · Fleet** · More ▾
Phone: bottom bar with the same four items, project selector in the top bar, More in the top-right menu.

| Section | Needs project | Purpose | Edits? |
|---|---|---|---|
| Project Progress | yes | Dashboards: project → area → category | read-only |
| Project Management | yes | Update project records, by discipline | yes (role-based) |
| Foundation Overview | yes | One foundation's full status | read-only |
| Fleet | no | Existing module | as today |

**More** ▾ holds Setup (foundations, areas, Anchorage Library, anchorage types, suppliers, pours), Crew, Safety, Data & backups, and Access. Nothing is removed; admin gating is unchanged.
The 7 placeholder sidebar entries are dropped from the navigation (see decisions).

### 2.2 Routes
URLs keep the existing `/projects/:projectId` prefix, so most existing links and bookmarks keep working. Old paths that move are redirected.

```
/                                              → last-used project's Project Progress (project picker if none)
/projects/:p/progress                          Project overview: area cards
/projects/:p/progress/:area                    Area dashboard: five category tiles
/projects/:p/progress/:area/materials          Materials detail by category (read-only)
/projects/:p/progress/:area/materials/:key     One material requirement → foundations that need it
/projects/:p/progress/:area/{construction|survey|qaqc}   Existing figures and records for that area (read-only view of what exists)
/projects/:p/progress/:area/civil              Future-development placeholder
/projects/:p/manage                            Opens Materials & Procurement
/projects/:p/manage/materials                  Materials & Procurement workspace (tabs below)
/projects/:p/manage/construction | survey | qaqc   Existing editing screens, area selector on top
/projects/:p/manage/civil                      Future-development placeholder
/projects/:p/foundation                        Selector: Area → Foundation designation
/projects/:p/foundation/:foundationId          Foundation Overview (Materials live; other categories show existing records)
/projects/:p/setup/…                           Configuration (More ▾)
/fleet/…                                       Fleet, internals unchanged
```
Redirects: `/procurement` and `/projects/:p/procurement` → `manage/materials`; `/projects/:p/materials[/records]` → `manage/materials` (Records tab) or `progress` as appropriate; `/projects/:p/areas/:a/foundations/:f` → `foundation/:f`; `/projects/:p/areas/:a` → `progress/:area`; `/projects/:p/fleet` → `/fleet`. A route-parity test will check every current path.

### 2.3 The five categories in each section
| Category | Project Progress | Project Management | Foundation Overview |
|---|---|---|---|
| Materials | **new** read-only dashboards | **new** Materials & Procurement workspace | **new** materials section |
| Construction / Installation | existing indicator and figures, unchanged | existing editing screens, relocated | existing activity records |
| Survey | existing indicator, unchanged | existing screens, relocated | existing activity records |
| QA/QC | existing indicator, unchanged | existing screens, relocated | existing activity records |
| Civil / Earthworks | "Future development" tile | "Future development" page | "Future development" row |

---

## 3. Layouts for review

Legend: `[ ]` button/filter, `▸` link to underlying records. All quantities link through to their records.

### 3.1 Project Progress → Project overview
```
Project: E-House Expansion ▾     [Project Progress] Project Management  Foundation Overview  Fleet  More ▾
────────────────────────────────────────────────────────────────────────────────────────────────────────
Project Progress                                   Read-only · as of today
Materials (whole project)    Required 214   Ordered 160   Delivered 118   Outstanding 96   ▸ Materials detail
                              ██████████░░░░░░░░ 55% delivered in full
Areas
┌ E-House ─────────────┐ ┌ Mole Sieve ───────────┐ ┌ Propane BOG ─────────┐
│ Materials   62% ████ │ │ Materials   48% ███   │ │ Materials   40% ██   │
│ Construction 41%     │ │ Construction 30%      │ │ Construction 12%     │
│ Survey       25%     │ │ Survey       10%      │ │ Survey       —       │
│ QA/QC        18%     │ │ QA/QC        —        │ │ QA/QC        —       │
│ Civil   Future dev.  │ │ Civil  Future dev.    │ │ Civil  Future dev.   │
│ 14 materials outstanding ▸│ ...                │ │ ...                  │
└──────────────────────┘ └───────────────────────┘ └──────────────────────┘
Needs attention (existing issues panel)
```
No combined project or area percentage is introduced. Each category keeps its own figure (Materials from the unified model; Construction, Survey and QA/QC exactly as the existing indicators calculate them, with their existing "Not tracked" wording when records cannot support a figure).

### 3.2 Project Progress → Area dashboard
```
E-House                                                       ◂ All areas
┌ Materials ───────────────┐ ┌ Construction / Installation ┐ ┌ Survey ──────┐
│ 62% delivered in full     │ │ 41% (existing)              │ │ 25% (existing)│
│ Req 54 · Ord 48 · Del 34  │ │ ▸ open                      │ │ ▸ open        │
│ Outstanding 20 ▸          │ └─────────────────────────────┘ └───────────────┘
└───────────────────────────┘ ┌ QA/QC ──────────────────────┐ ┌ Civil / Earthworks ┐
                              │ 18% (existing) ▸ open       │ │ Future development │
                              └─────────────────────────────┘ └────────────────────┘
```

### 3.3 Project Progress → Materials (read-only)
```
E-House · Materials                         Area: [All ▾]   Category: [All ▾]
Required 54   Ordered 48   Delivered 34   Allocated 30   Installed 12   Outstanding (not yet delivered) 20

By material category                     Req   Ord   Del   Out   Progress
Anchor bolts                              12    12     9     3    ███████░░ 75%
Nuts                                      12    10     6     6    █████░░░░ 50%
Washers                                   12    10     6     6    █████░░░░ 50%
Sole plates                                6     6     6     0    █████████ 100%
Plywood templates                          6     4     2     4    ███░░░░░░ 33%
Embed plates                               6     6     5     1    ████████░ 83%

By area (when "All areas")               Req   Ord   Del   Out   Progress
E-House … Mole Sieve … Propane BOG …

Requirement list (read-only)  → each row: material · spec · required · ordered · delivered · allocated · installed · outstanding · stage badge
   Row ▸ opens "Foundations needing this material" → each foundation links to Foundation Overview → Materials
```
Counts are material requirement lines and each line also shows its quantity in pieces. Percentages keep today's definition (a requirement counts when its full required quantity has been delivered). I will not mix units in one total; see decisions.

### 3.4 Project Management → Materials & Procurement
One workspace. Tabs replace the six current entry points; every existing function stays reachable.
```
Project Management   [Materials & Procurement] Construction  Survey  QA/QC  Civil (future)
────────────────────────────────────────────────────────────────────────────────
Materials & Procurement                         ⟲ synced   you: Editor
Summary strip (clickable filters):
 [To order 12] [Ordered, not delivered 28] [Partly delivered 9] [Delivered 34] [Allocated 30] [Installed 12]
 Unlinked deliveries notice (existing) if any

Filters:  Area [All ▾]  Foundation [All ▾]  Category [All ▾]  Status [Any ▾]  Search […]   ⊞ List|Blocks

Tabs:  Requirements 54 │ Orders 6 │ Deliveries 11 │ Allocate & install 30 │ Records & history
```
**Requirements** (default; today's tab, enhanced)
```
☐ Material / spec     Area       Required Ordered Delivered Outstanding  Stage            Actions
☐ 3/4" × 460 bolts    E-House        20     20       12        8      Partially delivered  Order · Receive
☐ Nuts 3/4"           E-House        40     20        0       40      Partially ordered     Order
Selected 2: [New order from selection] [Receive delivery] [Allocate…]      Row ▸ detail drawer
```
Row detail drawer: calculation breakdown (which foundations contribute), orders and deliveries that touch it, allocations, installations, history.

**Orders** (today's tab): order list with name, number (optional), supplier (optional), lines, status; actions edit quantities, add lines, cancel (allowed with deliveries, as now), delete (existing rule), receive against order.

**Deliveries** (new tab; today deliveries are reachable only from orders/requirements): every delivery, newest first, with order link or "No order (unlinked)", received by/when, lines; **Record delivery**, **Correct**, **Void** using the existing commands and permissions.

**Allocate & install** (new tab; today inside the requirement dialog): per requirement, delivered → allocated to foundations → installed; bulk allocate, record/void installation using the existing commands.

**Records & history**: the existing "Material records" content (line list, import, export CSV, reconcile, archive) plus a change history from the existing audit trail.

Edit controls are shown only to roles with the permission, and the server already re-checks every command.

### 3.5 Foundation Overview → Materials
```
Foundation Overview        Area [E-House ▾]   Foundation [OP1-01-01 ▾]     (also reached from any ▸ link)
OP1-01-01 · E-House · 6 footings (shown as one designation) · footing 4.0×4.0×1.0 m · anchorage types: A, B · Concrete 96 m³
Materials readiness:  4 of 6 requirements delivered · 3 allocated · 1 installed       Overall materials ████░░ 50%

Materials                    Required  Ordered*  Delivered*  Allocated here  Installed*  Outstanding   Stage
Anchor bolts 3/4"×460          24        24        12            12             0            12       Partially delivered
Nuts                           48        24         0             0             0            48       Partially ordered
Embed plate EP-1               12        12        12            12             4             0       Partially installed
* project-level quantities (shared with other foundations); "Allocated here" is this foundation's own.
Construction / Installation  (existing activity records, unchanged)
Survey   (existing)      QA/QC   (existing)      Civil / Earthworks   Future development
```
A bulk delivery is never shown as "this foundation has it": ordered/delivered/installed are labelled project-level, and only Allocated here is foundation-specific. Individual physical footings are shown as one designation for now.

### 3.6 Mobile and iPad
- Bottom bar: Progress · Manage · Foundation · Fleet. Project selector in the top bar.
- Tables become cards on phones (the existing `Cards` components); the summary strip scrolls horizontally; filters collapse behind a "Filters" button; bulk actions appear in a sticky bottom bar.
- iPad keeps the tab bar and the two-column drawer.

---

## 4. Mapping of existing pages

| Existing | Becomes | Action |
|---|---|---|
| Dashboard `/`, Project overview | Project Progress → overview | rebuild (Materials from unified model; others as existing indicators) |
| Area Overview | Progress → Area dashboard | rebuild |
| Project Materials / Area Materials tab / Material records | Progress → Materials (read) and Manage → Records & history | relocate, no logic change |
| Procurement (global and project) | Manage → Materials & Procurement | relocate + add tabs |
| Area Construction and Quality tabs | Manage → Construction / Survey / QA/QC (area selector) | embed existing components unchanged |
| Foundation page | Foundation Overview | keep existing activity content, Materials section added |
| Foundation Register, Add/Edit Foundation, Anchorage Library/types, pours, suppliers | Setup (More) | relocate |
| Issues | Progress overview "Needs attention" | keep |
| Fabrication, Handover | unchanged, demo-only | stay hidden in server mode |
| Fleet | Fleet | unchanged internally |
| Crew, Safety, Data & backups | More | relocate |

---

## 5. Materials calculations (unchanged rules)
All three Materials interfaces call the same Phase 1 `materialsModel` / `procurementRows`:
- Required, ordered, delivered, allocated, installed and outstanding come from one calculation; cancelled orders count only what was delivered; unlinked deliveries count; allocations and installations never double count.
- Percentages keep their current definition (fully delivered requirements ÷ requirements).
- No new project-level or area-level combined progress and no category weights.

New derived views needed (display only, no new stored data): totals by material category and by area, "outstanding to order" (required − ordered) and "outstanding to deliver" (required − delivered), and foundations-needing-this-requirement lists. They will be built into the same model with oracle tests.

---

## 6. Revised implementation roadmap
Everything is committed to `staging` only, after tests pass, and nothing structural is deployed before you approve this document.

| Stage | Scope | Data change |
|---|---|---|
| **1. Navigation & layout** | Project context and selector, four-section frame, More menu, phone bottom bar, redirects, existing pages mounted unchanged under new routes, Future-development placeholder component, route-parity test | none |
| **2. Project Progress → Materials** | Project overview, Area dashboard, Materials detail (category, area, requirement, foundation drill-down), model additions | none |
| **3. Project Management → Materials & Procurement** | Single workspace: summary strip, filters, Requirements, Orders, Deliveries, Allocate & install, Records & history, detail drawer | none |
| **4. Foundation Overview → Materials** | Selector and materials section, project-level vs foundation-level labelling | none |
| **5. End-to-end test & refinement** | Scenario tests across areas and categories, agreement checks across the three views, permission tests (viewer/editor/admin), Playwright at desktop, iPad and phone widths, existing staging data preserved | none |

Each stage ends with: full test suite, typecheck, lint, build, and a summary of what changed. I cannot reach the staging host from this session, so I will not claim staging verification.

---

## 7. Risks and dependencies
- **Link and bookmark breakage** → redirects for every moved path, plus a route-parity test.
- **Existing behavior** (order delete/cancel, delivery corrections, allocations, installations, permissions) → the existing commands and permission map are reused, not rewritten; existing tests must keep passing.
- **Mixed units** in category totals → I will check how each category stores units and avoid summing different units.
- **Reusing existing Construction/Survey/QA/QC screens** under a new frame could expose layout assumptions (they were built for the Area page) → check each at phone, iPad and desktop widths.
- **Placeholders** must read as clearly "future development", never as zero progress.
- **Not reviewed:** Crew, Safety and Fabrication/Handover contents **(not checked)**.

## 8. Decisions requested
1. **Navigation:** approve the four-section frame, the More menu, and dropping the 7 placeholder sidebar items.
2. **URLs:** keep the `/projects/:p/…` prefix (fewer redirects) rather than introducing `/p/…`. *Recommended: keep.*
3. **Progress figures:** show each category separately with no combined project/area percentage in this phase.
4. **Materials percentage:** keep "fully delivered requirements ÷ requirements" and show piece quantities beside it, rather than changing the definition.
5. **Workspace tabs:** approve Requirements · Orders · Deliveries · Allocate & install · Records & history.
6. **Foundation Overview:** designation-level only for now (individual footings deferred); approve the Materials chain layout in 3.5.
7. **Construction / Survey / QA/QC under Project Management:** embed the existing Area screens with an area selector (no workflow changes).
8. **Civil / Earthworks:** labelled "Future development" tile and page.
