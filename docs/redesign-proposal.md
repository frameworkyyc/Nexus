# Nexus — Navigation & Materials Redesign (Revised, Materials-first scope)

Status: **proposal for review. No code has been changed.** Branch `staging`.
This revision replaces the earlier all-disciplines proposal. **Approved with one modification (section 5): Materials progress is quantity-based, shown separately for Ordered, Delivered, Allocated and Installed.** Facts come from the code and a read-only query of `nexus-staging`; anything not checked is marked **(not checked)**.

## 0. Scope of this phase

**In scope**
- The new four-section navigation and layout (Project Progress, Project Management, Foundation Overview, Fleet).
- New Procurement functionality in all three project views, built on the unified Materials model from Phase 1.
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

### 2.1 Frame (revised after Stage 1 review: the left sidebar is back)
**Desktop (1024px and up):** the original dark Nexus sidebar stays open on the left. It lists the four sections, **Project Progress, Project Management, Foundation Overview and Fleet**, and each one expands to its own pages (areas, disciplines, setup pages), so any page is one click away. Below them a secondary **Tools** group holds Setup (expandable), Issues, Fleet on this project, Fabrication/Handover (demo only), All projects, Company overview, Crew, Safety and Data & backups. A toggle shrinks the sidebar to an icon rail (remembered).
**Header:** the **project selector** and breadcrumbs on the left; sync status and the user on the right.
**iPad (768 to 1023px):** the icon rail stays in view; its toggle opens the full sidebar over the page (closes on selection, backdrop tap or Escape).
**Phone:** the bottom bar with Progress · Manage · Foundation · Fleet, the project selector in the top bar, and a menu with the Tools list.

| Section | Needs project | Purpose | Edits? |
|---|---|---|---|
| Project Progress | yes | Dashboards: project → area → category | read-only |
| Project Management | yes | Update project records, by discipline | yes (role-based) |
| Foundation Overview | yes | One foundation's full status | read-only |
| Fleet | no | Existing module | as today |

The 7 "coming soon" sidebar placeholders stay out of the navigation.

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
/projects/:p/manage                            Opens Procurement
/projects/:p/manage/materials                  Procurement workspace (tabs below)
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
| Materials | **new** read-only dashboards | **new** Procurement workspace | **new** materials section |
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
Materials (whole project)   Required 214 pcs · Outstanding to deliver 96     ▸ Materials detail
   Ordered     ████████████░░░░ 75%      Delivered ██████████░░░░░░ 55%
   Allocated   ████████░░░░░░░░ 48%      Installed ████░░░░░░░░░░░░ 20%
Areas
┌ E-House ─────────────┐ ┌ Mole Sieve ───────────┐ ┌ Propane BOG ─────────┐
│ Materials  see below │ │ Materials  see below  │ │ Materials  see below │
│ Construction 41%     │ │ Construction 30%      │ │ Construction 12%     │
│ Survey       25%     │ │ Survey       10%      │ │ Survey       —       │
│ QA/QC        18%     │ │ QA/QC        —        │ │ QA/QC        —       │
│ Civil   Future dev.  │ │ Civil  Future dev.    │ │ Civil  Future dev.   │
│ 14 materials outstanding ▸│ ...                │ │ ...                  │
└──────────────────────┘ └───────────────────────┘ └──────────────────────┘
Needs attention (existing issues panel)
```
No combined project or area percentage is introduced. Each category keeps its own figure. Materials shows its four quantity-based percentages (section 5) on the area card, replacing the single "delivered in full" figure. Construction, Survey and QA/QC are exactly as the existing indicators calculate them, with their existing "Not tracked" wording when records cannot support a figure.

### 3.2 Project Progress → Area dashboard
```
E-House                                                       ◂ All areas
┌ Materials ───────────────┐ ┌ Construction / Installation ┐ ┌ Survey ──────┐
│ Ordered    88% ████████░  │ │ 41% (existing)              │ │ 25% (existing)│
│ Delivered  62% ██████░░░  │ │ ▸ open                      │ │ ▸ open        │
│ Allocated  55% █████░░░░  │ └─────────────────────────────┘ └───────────────┘
│ Installed  22% ██░░░░░░░  │
│ Outstanding to deliver ▸  │
└───────────────────────────┘ ┌ QA/QC ──────────────────────┐ ┌ Civil / Earthworks ┐
                              │ 18% (existing) ▸ open       │ │ Future development │
                              └─────────────────────────────┘ └────────────────────┘
```

### 3.3 Project Progress → Materials (read-only)
```
E-House · Materials                         Area: [All ▾]   Category: [All ▾]
Required 54   Ordered 48   Delivered 34   Allocated 30   Installed 12   Outstanding (not yet delivered) 20

By material category        Required   Ordered      Delivered     Allocated     Installed    Outstanding
Anchor bolts (pcs)             100     100 100%      95  95%      80  80%       0   0%        5
Nuts (pcs)                     200     120  60%      60  30%      60  30%       0   0%      140
Washers (pcs)                  200     120  60%      60  30%      60  30%       0   0%      140
Sole plates (pcs)               12      12 100%      12 100%      12 100%      12 100%        0
Plywood templates (pcs)         12       8  67%       4  33%       4  33%       0   0%        8
Embed plates (pcs)              12      12 100%      10  83%       8  67%       4  33%        2
(each percentage = quantity ÷ required quantity, capped at 100% per requirement; outstanding = required − delivered)

By area (when "All areas")  same columns per area: E-House … Mole Sieve … Propane BOG …

Requirement list (read-only)  → each row: material · spec · required · ordered · delivered · allocated · installed · outstanding · stage badge
   Row ▸ opens "Foundations needing this material" → each foundation links to Foundation Overview → Materials
```
Totals are in pieces and each percentage is quantity-based (section 5). Aggregates are only formed within a material category, never across categories with different units.

### 3.4 Project Management → Procurement
One workspace. Tabs replace the six current entry points; every existing function stays reachable.
```
Project Management   [Procurement] Construction  Survey  QA/QC  Civil (future)
────────────────────────────────────────────────────────────────────────────────
Procurement                         ⟲ synced   you: Editor
Summary strip (clickable filters):
 Ordered 88% · Delivered 62% · Allocated 55% · Installed 22%   (quantity-based, of required)
 [To order 12] [Ordered, not delivered 28] [Partly delivered 9] [Delivered 34] [Allocated 30] [Installed 12]  ← requirement counts, clickable filters
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
Material readiness (this foundation's own requirements, quantity-based):
   Ordered 100% · Delivered 62% · Allocated here 62% · Installed 17%      Outstanding to deliver: 20 pcs

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
| Procurement (global and project) | Manage → Procurement | relocate + add tabs |
| Area Construction and Quality tabs | Manage → Construction / Survey / QA/QC (area selector) | embed existing components unchanged |
| Foundation page | Foundation Overview | keep existing activity content, Materials section added |
| Foundation Register, Add/Edit Foundation, Anchorage Library/types, pours, suppliers | Setup (More) | relocate |
| Issues | Progress overview "Needs attention" | keep |
| Fabrication, Handover | unchanged, demo-only | stay hidden in server mode |
| Fleet | Fleet | unchanged internally |
| Crew, Safety, Data & backups | More | relocate |

---

## 5. Materials progress calculations (approved modification)

Materials progress is **quantity-based and shown as four separate percentages**: Ordered, Delivered, Allocated and Installed. There is no single "delivered in full" figure and no blended Materials number.

**Definitions** (for any set of requirements: a foundation, an area, a material category, or the project):
- For each requirement *r* with required quantity `req(r) > 0`, `stage%(r) = min(stageQty(r) ÷ req(r), 1)` for stage = ordered, delivered, allocated, installed.
- For a set, `stage% = Σ min(stageQty(r), req(r)) ÷ Σ req(r)`. The cap is applied **per requirement before summing**, so a surplus on one requirement (e.g. 110 delivered against 100 required) can never hide a shortfall on another. Example: 95 of 100 anchor bolts delivered displays **95%**, not 0%.
- Requirements with `req = 0` are excluded. A set with no requirements shows "No requirements", never 0% or 100%.
- Outstanding to deliver = `max(req − delivered, 0)` per requirement, summed; "outstanding to order" = `max(req − ordered, 0)`. Over-delivery is shown as a separate "surplus" note, not as negative outstanding.
- Percentages are only aggregated inside one material category (all pieces) and then across categories as piece totals. Categories with a different unit are not summed; I will check the stored unit of each category before building the aggregate, and show per-category figures only if units differ.

**Source quantities (unchanged underlying procurement calculation):** `required`, `ordered`, `delivered` (received), `allocated` and `installed` are exactly what `procurementRows` / `materialsModel` already produce, so cancelled orders still count only what was delivered, unlinked deliveries still count, and allocations and installations never double-count. This change adds display-level percentages on top; it does not alter any stored or calculated quantity.

**Project-level availability vs foundation-specific allocation:**
- *Ordered, Delivered and Installed* are project-level for a requirement that several foundations share (the order and delivery are recorded once per area and specification). On a Foundation Overview they are labelled "project-level".
- *Allocated here* is foundation-specific: the quantity assigned to that foundation. A foundation's Allocated % is its allocation ÷ its own requirement, and is never inferred from a project delivery.
- A foundation's Delivered % is therefore shown as availability of the shared requirement ("project delivered X of Y") and is not claimed as "this foundation has received it".

The existing requirement-level stage badge (Pending … Installed) stays as it is for single rows. The old "fully delivered requirements ÷ requirements" count remains available only as a requirement count in the summary strip (e.g. "Delivered 34 requirements"), not as the progress percentage.

New derived views (display only, no new stored data): totals by material category and by area, outstanding-to-order and outstanding-to-deliver, and foundations-needing-this-requirement lists. These will be added to the same model with oracle tests, including the capping rule, shared requirements and the 95-of-100 case, in Stage 2.

---

## 6. Revised implementation roadmap
Everything is committed to `staging` only, after tests pass, and nothing structural is deployed before you approve this document.

| Stage | Scope | Data change |
|---|---|---|
| **1. Navigation & layout** | Project context and selector, four-section frame, More menu, phone bottom bar, redirects, existing pages mounted unchanged under new routes, Future-development placeholder component, route-parity test | none |
| **2. Project Progress → Materials** | Project overview, Area dashboard, Materials detail (category, area, requirement, foundation drill-down), quantity-based stage percentages in the model | none |
| **3. Project Management → Procurement** | Single workspace: summary strip, filters, Requirements, Orders, Deliveries, Allocate & install, Records & history, detail drawer | none |
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
4. ~~Materials percentage~~ **Decided:** quantity-based Ordered, Delivered, Allocated and Installed percentages against required quantity, capped at 100% per requirement (section 5).
5. **Workspace tabs:** approve Requirements · Orders · Deliveries · Allocate & install · Records & history.
6. **Foundation Overview:** designation-level only for now (individual footings deferred); approve the Materials chain layout in 3.5.
7. **Construction / Survey / QA/QC under Project Management:** embed the existing Area screens with an area selector (no workflow changes).
8. **Civil / Earthworks:** labelled "Future development" tile and page.

---

## 9. Stage 1 status (navigation and layout): implemented on `staging`

Done: four-section frame (desktop/iPad header, phone bottom bar), project selector that keeps the section, More menu (Setup, Issues, Fleet on this project, Fabrication/Handover in the demo only, All projects, Company overview, Crew, Safety, Data & backups), redirects for every moved path, Project Management with the existing Construction/Survey/QA/QC screens behind an area selector, Civil / Earthworks "Future development", Foundation Overview selector, Setup hub. The seven placeholder sidebar items are gone.

Transitional (replaced in later stages, no behavior changed in Stage 1):
- Project Progress shows today's project and area pages; the Materials dashboards and quantity-based percentages arrive in Stage 2.
- Manage → Procurement is today's Procurement page (the public demo bundle shows its Materials page, as before). "Material records" is a temporary extra tab until Stage 3 folds it into Records & history.
- Foundation Overview opens today's foundation page; the Materials table comes in Stage 4.
- Survey and QA/QC open the same existing table (they are recorded together today).

Notes: `/` opens the last-used project's Progress (the company overview is at `/overview`). A project's own Fleet view is kept at `/projects/:p/fleet` (reachable from More) because it has project-specific tasks that `/fleet` does not.

## 10. Area navigation refinement (implemented on `staging`)

Every Area page now has the same five tabs, in this order: **Overview, Materials, Construction, Survey, QA/QC**.
- **Foundations** is no longer a tab. The Foundations summary, tiles and the full register (search, filters, plinth view, add/edit actions and links) are a section of Overview. In the demo, the area's Handover section is also shown on Overview (it was a tab); saved-data mode never had it.
- The four progress graphs read **Materials, Construction, Survey, QA/QC** ("Installation" is renamed Construction) and each opens its own tab.
- **Survey** shows layout and the pre-pour and as-built survey checks; **QA/QC** shows the pre-pour (CM03) and post-pour (CM04) inspections. Both read the same activity records as before; nothing new is tracked or calculated.
- Old addresses keep working: `?tab=register` and `?tab=handover` open Overview, `?tab=quality` opens Survey.
- Project Management is unchanged (its Survey and QA/QC entries still show the combined table).

## 11. Simplified sidebar (implemented on `staging`; supersedes the section lists in 2.1)

There is no Project Management parent and no Project Management page or crumb. Progress is renamed **Project Status**. The sidebar reads, top to bottom:
- **Project Status** (expandable): Project Overview, then each Area.
- **Operational pages** (direct links): Procurement, Construction / Installation, Survey, QA/QC, Civil / Earthworks (tagged Future).
- **Foundation Overview** (expandable by Area) and **Fleet**.
- **Tools**: Setup (expandable), Issues, Fleet on this project, Fabrication/Handover (demo), All projects, Company overview, Crew, Safety, Data & backups.

URLs are unchanged (`/projects/:p/manage/...` stays; `/manage` alone still redirects to Procurement). The project's Materials-by-area page and Material records, which sat in the old Management tab row, are linked from the Procurement page header. On phones the bottom bar is Status · Materials · Foundation · Fleet, and the menu lists the other operational pages, then the tools.
