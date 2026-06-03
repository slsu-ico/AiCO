# Admin Workflow Completion Design

## Goal

Complete the first practical slice of the AiCO admin workflow gaps: notify office users when content review decisions happen, show reviewers what changed against the currently published version, expose review history for a content item, and let admins manage user activation and assignment without direct database access.

## Scope

This pass keeps the existing server-rendered Node.js admin console and PostgreSQL schema. It does not add an external email provider yet. Email notification support is implemented through a small injectable mailer interface with a no-op default sender, so production SMTP or API delivery can be added later without rewriting review routes.

Included:

- Content review decision notifications for approved, rejected, and needs-revision outcomes.
- A review detail comparison between the pending version and the current published version of the same content item.
- An admin audit/history screen for all review notes attached to versions of one content item.
- An admin user management screen for listing users, deactivating/reactivating users, and updating role or office assignment.

Not included:

- Password reset flows.
- New database tables.
- Production SMTP/API provider configuration.
- Full text-level diff algorithms. The diff is field-based and structured for reviewer clarity.

## Architecture

The implementation follows the current app structure:

- `src/adminRoutes.js` remains the HTTP route/controller layer.
- `src/adminViews.js` renders the new HTML sections.
- `src/layout.js` gets one admin navigation link for users if needed.
- `src/notificationMailer.js` provides an injectable notification boundary.
- Existing tests in `test/adminRoutes.test.js` cover route behavior with fake pools and Redis clients.

Review actions continue to write status changes in transactions. After the transaction and cache work complete, the route calls the mailer. Mailer failures are intentionally non-blocking: the admin decision should still succeed.

## Data Flow

For review detail pages, the route fetches the requested content version and joins `content_items` and `offices`. It also fetches the current published version by `content_items.current_published_version_id`. The view renders submitted and published fields side by side and marks changed fields.

For audit history, the route receives a content item id, joins `review_notes`, `content_versions`, and `users`, and renders a chronological history.

For user management, the list route reads users with office names and all offices for reassignment forms. Admin-only POST routes update `active`, `role`, and `office_id`.

## Error Handling

Only admins can access review, audit, and user management routes. Invalid ids return 404 or a bad request through existing helpers. User management actions validate role and office id before updating. Notification failures are swallowed after the decision succeeds because email is not the source of truth.

## Testing

Use TDD with focused `node:test` coverage:

- Review detail renders a published-vs-pending diff and history link.
- Review actions call the injected notification mailer with the correct recipient and status.
- Audit history route renders review notes for a content item.
- User management list and actions are admin-only and perform the expected SQL updates.

Run the focused admin route tests first, then the full test suite.
