# Role-Based AiCO Admin Console Redesign

## Purpose

Redesign AiCO Admin as a polished internal operations console whose UI and workflows adapt to each user type: anonymous requesters, office users, ICO admins/reviewers, and the chatbot read path. The redesign should improve the currently implemented server-rendered app while establishing a coherent UX system for planned management, revision, history, and attachment workflows.

## Product Principles

- Prioritize the user's next operational action over generic dashboard decoration.
- Keep live chatbot content protected: pending, rejected, draft, and revision content must never look published.
- Make review status visible everywhere a content item or account request appears.
- Use a restrained SLSU/ICO visual system: green and gold accents, white work surfaces, crisp borders, readable density, and accessible contrast.
- Prefer refined institutional depth over flat color: the sidebar uses deep forest green with a subtle diagonal texture.
- Prefer scan-friendly tables, queues, timelines, and action panels over large marketing-style cards.
- Make mobile layouts usable for review and forms, with actions staying clear and reachable.

## User Types

### Anonymous Requester

Anonymous users can sign in or request an account. Their experience should feel like an access gateway, not a full admin shell.

Screens:

- Login.
- Request account.
- Request submitted confirmation.

UX requirements:

- Login page has a compact centered access panel with the AiCO/SLSU identity, email/password fields, sign-in action, and a clear request-account link.
- Request account form is grouped into identity, office details, access reason, and remarks/supporting context.
- Confirmation state explains that the request is awaiting ICO admin review.
- Validation notices are visible near the form and written in plain language.

### Office User

Office users need a workbench for creating, tracking, revising, and resubmitting office content.

Screens:

- Office dashboard.
- New content editor.
- Drafts and submissions.
- Submission detail.
- Revision workspace.
- Submission history.
- Attachment panel.

UX requirements:

- Dashboard starts with action queues: Needs revision, Drafts, Pending review, Published, Rejected.
- The primary CTA is Submit content.
- Submission rows show title, content type, status, submitted date, latest admin note, and next action.
- Status badges use consistent labels and colors: Draft, Pending review, Published, Needs revision, Rejected, Archived.
- Returned submissions expose the admin note, reviewer, review date, affected version, and a Resubmit action.
- Content editors are type-aware for Citizen's Charter service, FAQ, event, project, program, and activity.
- Citizen's Charter forms group fields into basic information, eligibility/audience, requirements, procedure, fees/time, official links, and attachments.
- FAQ forms prioritize question, answer, related office/service, keywords, and active status.
- Event/project/program/activity forms prioritize title, description, date or date range, status, related links, and attachments.
- Attachments appear as a supporting-document panel with filename, type, size, upload status, and remove/replace actions where allowed.

### ICO Admin / Reviewer

Admins need a dense operations console for account access, content review, publishing, and management.

Screens:

- Admin dashboard.
- Account request queue.
- Account request detail.
- Content review queue.
- Content review detail.
- Content inventory.
- User management.
- Office management.
- Audit and review notes.

UX requirements:

- Dashboard surfaces queue counters, workload, published content health, and recent activity.
- Dashboard stat cards are clickable and link directly to the relevant queue.
- Account request rows separate applicant context from decision controls.
- Account request rows include applicant initials avatars alongside names for faster scanning.
- Account request review includes applicant identity, requested office, position, reason, remarks, attachment list, office assignment, role selection, temporary password, and approve/reject/needs-info actions.
- Rejection and needs-info actions require admin notes.
- Content review queue is filterable by content type, office, submitted date, and status.
- Content review detail is a reviewer workspace with submitted content, structured payload, attachments, submitter and office context, current published version, review notes, and decision panel.
- Content review decisions appear side-by-side as Approve, Request revision, and Reject panels on wider screens.
- Approval clearly states that the reviewed version will become chatbot-visible published content.
- Request-revision and reject actions require notes and keep live content unchanged.
- Admin topbar includes a Refresh cache action that manually purges the published-content Redis cache when route support is implemented.
- User management supports creating users, assigning offices, setting roles, and activating/deactivating accounts.
- Office management supports creating and updating office name, abbreviation, contact email, contact number, and active status.
- Audit views show reviewer, action, note, and timestamp for content and account decisions.

### Chatbot Reader

The chatbot is not a visual user, but the admin UI must protect and clarify its read path.

UX requirements:

- Published content should be marked as available to the chatbot.
- Pending review, needs revision, rejected, draft, and archived items should be visibly excluded from chatbot answers.
- Admin approval should invalidate the published-content cache as it does today.
- Dashboards and content inventory should distinguish published records from working submissions.

## Information Architecture

### Anonymous Navigation

- Sign in.
- Request account.

### Office User Navigation

- Dashboard.
- Submit content.
- Submissions.
- Drafts.
- History.

### Admin Navigation

Review:

- Dashboard.
- Account requests.
- Content reviews.

Manage:

- Content inventory.
- Users.
- Offices.

System:

- Audit notes.
- Published chatbot content.

Only implemented routes should link immediately. Planned areas may be introduced after route handlers exist or as explicit disabled navigation labels if the implementation chooses to show future structure.

## Layout System

The app shell uses:

- Left sidebar with role-specific grouped navigation.
- Navigation groups use labels such as Overview, Manage, and Settings/System to add hierarchy and scannability.
- Navigation items support live badge counts, such as pending account requests and pending content reviews for admins.
- Compact brand block for Southern Luzon State University and AiCO Admin.
- User summary with initials avatar, name, role, and office when available.
- Topbar with page title, contextual subtitle, primary action, and system status.
- Admin topbar can expose a Refresh cache button when the current user has permission.
- Main workspace constrained for readability, with wider review/detail pages when needed.
- Section headers, queue summaries, filter bars, data tables, action panels, timelines, and form sections.

Visual tokens:

- Primary green: deep forest green, `#022519`, for the sidebar and core shell.
- Sidebar texture: subtle diagonal repeating-gradient overlay on the deep forest background.
- Accent gold: SLSU gold for active navigation and important highlights.
- Neutral workspace: cool light gray-green.
- Surfaces: true white.
- Text: dark green-black for primary text, muted gray-green for secondary text.
- Borders: soft gray-green.
- Semantic colors: blue for informational/pending, gold for needs-info/revision, green for approved/published, red for rejected/destructive.
- Radius: 8px or less.
- Typography: system sans-serif with deliberate sizes for headings, labels, table cells, buttons, and helper text.

## Components

Shared primitives:

- Role-aware navigation groups.
- Badge-count navigation items.
- Page header with title, subtitle, and actions.
- Notice banners.
- Metric/queue summaries.
- Status badges.
- Initials avatars for users and applicants.
- Filter bars.
- Responsive data tables.
- Detail summary lists.
- Form sections.
- Decision/action panels.
- Review timelines.
- Empty states.
- Attachment lists.
- Drag-and-drop styled upload zones with accepted file type hints.

Component rules:

- Tables remain the primary pattern for dense queues.
- People rows use initials avatars where names are available.
- Cards are used for individual repeated items, summaries, or action panels, not as nested page wrappers.
- Dashboard summary cards are actionable links when they represent a queue.
- Status badges include both text and colored dots.
- Buttons have clear hierarchy: primary, secondary, danger.
- Destructive actions are visually distinct and require notes where the workflow requires them.
- Form fields use labels, helper text when needed, and grouped sections rather than a long undifferentiated column.

## Current Implementation Scope

The first implementation pass should improve:

- `src/layout.js`: role-based grouped navigation, stronger shell, shared CSS primitives, topbar/page-header flexibility, badges, tables, forms, notices, and responsive behavior.
- `src/layout.js`: deep forest green sidebar (`#022519`), subtle diagonal texture, grouped navigation labels, initials-based session avatar, and badge-count support through `pageLayout`.
- Login and request-account screens.
- Admin dashboard.
- Admin dashboard count query should feed pending counts into `pageLayout` so navigation badges render.
- Office dashboard.
- Account request queue.
- Account request rows should show applicant initials avatars beside names.
- New content form.
- New content form should replace the plain file input presentation with a drag-and-drop styled upload zone and file type hints while preserving native upload behavior.
- Content review queue.
- Content review detail.
- Content review detail should use a three-column approve/request-revision/reject action layout on desktop and stack safely on mobile.
- Admin cache refresh should be exposed in the topbar only after a route exists to invalidate Redis keys.

The first pass should not pretend that unfinished database-backed screens are fully functional. User management, office management, drafts, revision resubmission, content inventory, audit views, and richer attachment panels can be designed into the layout system and implemented as later route work.

## Data And State

The redesign should use existing data first:

- User role and office from session.
- Dashboard counts for admins.
- Pending account request and pending content review counts for navigation badges.
- Office submission rows.
- Account request rows.
- Content review rows and details.
- Review notes and admin notes where currently queried.
- Content status and type labels.

Future data needs:

- Draft counts.
- Needs revision counts.
- Published count by office/content type.
- Recent activity.
- Current published version comparison.
- Attachment lists per request/submission.
- User and office management records.

## Error Handling And Safety

- Unauthorized users are redirected or shown forbidden messages as today.
- Forbidden pages should use the same console layout and explain the missing permission.
- Missing services should show a service-unavailable state with operational language.
- Required admin notes remain enforced for reject, needs-info, and needs-revision actions.
- File validation messages should be visible and specific.
- Approval language must make chatbot publishing explicit.

## Accessibility

- Preserve skip link.
- Use semantic headings and landmarks.
- Keep forms label-associated.
- Preserve `aria-current` for active navigation.
- Use text labels alongside status colors.
- Keep contrast strong for green/gold branding.
- Ensure mobile tables either remain scrollable with stable columns or convert to readable row groups.

## Testing Strategy

Update or add tests for:

- Role-specific navigation for anonymous, admin, and office users.
- Active navigation state.
- Login and request-account pages render the new grouped form structure.
- Admin dashboard renders queue summaries and actions.
- Office dashboard renders status badges and submission actions.
- Account request queue still includes approve, reject, and needs-info forms.
- Content review detail still includes approve, needs-revision, and reject forms.
- Existing authorization and workflow tests continue to pass.

Manual verification:

- Start the app locally.
- Check anonymous login and request-account pages.
- Check admin dashboard, account requests, content reviews, and review detail with seeded or test data.
- Check office dashboard and new content form.
- Verify desktop and mobile layouts.
- Run the full Node test suite.

## Open Decisions For Implementation Planning

- Whether planned navigation items should be hidden until routes exist or shown disabled as roadmap structure.
- Whether to keep all CSS inside `src/layout.js` or split a static stylesheet route.
- Whether account request review should remain inline in table rows for the first pass or move to a detail-page workflow.
- Whether content review detail should show raw structured JSON initially or render field-specific summaries.
- Whether mobile data tables should scroll horizontally or transform to stacked rows.
