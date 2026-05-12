# Office Content Admin Web App Design

## Purpose

Build a database-backed admin web app where SLSU offices can request accounts and submit updates for Citizen's Charter services, FAQs, events, projects, programs, and activities. ICO/admin users review these submissions before anything becomes live.

The Messenger chatbot will read only approved, published records from the database. Pending edits, rejected edits, and revision requests must never affect live chatbot answers.

## Scope

The first version is admin/database focused with chatbot integration. It does not include a public browsing website.

Included:

- Account request form for office staff.
- Admin-created or admin-approved user accounts.
- Office-specific content submission.
- Admin review and approval workflow.
- Admin notes for rejected or revision-requested submissions.
- Attachment uploads for account requests and content submissions.
- Published data feed/query for chatbot use.
- Import path for the existing `data/services.json` records.

Not included in the first version:

- Public-facing office/event/project directory.
- Open self-registration.
- Automatic publishing without admin review.
- Multi-office editing by ordinary office users.

## Recommended Architecture

Use a full web app with a real database.

Main components:

- Web Admin App: login, dashboards, account request queue, office user content forms, review screens, user management, office management.
- Database: offices, users, account requests, content items, content versions, review notes, attachments, and audit data.
- File Storage: uploaded PDFs, memos, images, and supporting documents.
- Approval Workflow: office submissions remain pending until admin action.
- Chatbot Read Path: chatbot queries only approved/published Citizen's Charter and FAQ records.
- Import Tool: current JSON service records can be loaded into the database as initial published content.

## Roles

### Super Admin / ICO Admin

Admins can:

- Review account requests.
- Create or approve user accounts.
- Assign users to offices.
- Activate or deactivate users.
- Manage offices.
- Review content submissions.
- Approve, reject, or request revision.
- Add review notes.
- Publish approved records.

### Office User

Office users can:

- Log in after admin approval.
- Create and edit records for their assigned office only.
- Submit content for review.
- Upload supporting attachments.
- View submission status.
- View admin notes.
- Revise and resubmit items returned for revision.

### Chatbot Reader

The chatbot can:

- Read approved/published Citizen's Charter service records.
- Read approved/published FAQ records.
- Ignore pending, rejected, archived, and draft content.

## Account Request Workflow

1. Staff member submits an account request.
2. Request includes name, email, office, position/designation, reason for access, remarks, and optional attachments.
3. Admin reviews the request.
4. Admin approves and creates the account, rejects the request, or requests more information with an admin note.
5. Approved user is assigned to one office and given an active role.

Account request statuses:

- Pending
- Approved
- Rejected
- Needs Info

Admin notes are required when rejecting an account request or requesting more information.

## Content Submission Workflow

1. Office user creates or edits a content item.
2. User saves as draft or submits for review.
3. Submitted version becomes Pending Review.
4. Current published version stays live.
5. Admin reviews the submitted version.
6. Admin chooses Approve, Reject, or Request Revision.
7. Approved content becomes the latest published version.
8. Rejected or revision-requested content does not affect the published version.

Content statuses:

- Draft
- Pending Review
- Published
- Rejected
- Needs Revision
- Archived

## Admin Review Notes

Admin notes are first-class review data.

When rejecting or requesting revision, admin must enter a note explaining what is wrong or what needs to change. The note is visible to the submitting office user.

Office users should see:

- Submission status.
- Admin note/comment.
- Reviewer name.
- Review date.
- Submitted version.
- Current published version, if one exists.

Example notes:

- "Please update the processing time based on the latest Citizen's Charter format."
- "Missing official request link. Add the correct form URL before resubmitting."
- "Attachment is unreadable. Please upload a clearer PDF."

## Content Types

The app supports these content types:

- Citizen's Charter service
- FAQ/chatbot answer
- Event
- Project
- Program
- Activity

Citizen's Charter service fields should include:

- Service name
- Description
- Office/unit
- Classification
- Transaction type
- Who may avail
- Requirements
- Submission timeline/reminders
- Official link
- Fees
- Processing time
- Client Satisfaction Survey reminder
- Audience, such as internal or external

FAQ fields should include:

- Question
- Answer
- Related office
- Related service, optional
- Search keywords, optional
- Active status

Events, projects, programs, and activities should include:

- Title
- Description
- Office
- Date or date range, where applicable
- Status
- Related links
- Attachments

## Data Model

### offices

Stores office records.

Suggested fields:

- id
- name
- abbreviation
- contact_email
- contact_number
- active
- created_at
- updated_at

### account_requests

Stores staff requests for access.

Suggested fields:

- id
- full_name
- email
- office_id or requested_office_name
- position
- reason
- remarks
- status
- admin_note
- reviewed_by
- reviewed_at
- created_at
- updated_at

### users

Stores approved application users.

Suggested fields:

- id
- full_name
- email
- office_id
- role
- active
- created_at
- updated_at

### content_items

Stores the stable identity of each content record.

Suggested fields:

- id
- office_id
- content_type
- current_published_version_id
- active
- created_by
- created_at
- updated_at

### content_versions

Stores drafts, pending submissions, approved versions, rejected versions, and revision versions.

Suggested fields:

- id
- content_item_id
- version_number
- status
- title
- body or structured_payload
- submitted_by
- submitted_at
- reviewed_by
- reviewed_at
- published_at
- created_at
- updated_at

For Citizen's Charter records, `structured_payload` should hold the service-specific fields in a consistent schema.

### review_notes

Stores review comments and revision instructions.

Suggested fields:

- id
- content_version_id
- reviewer_id
- action
- note
- created_at

### attachments

Stores uploaded file metadata.

Suggested fields:

- id
- linked_type
- linked_id
- original_filename
- file_type
- file_size
- uploaded_by
- storage_path
- created_at

The actual files should be stored in file storage, not directly in the database.

## Main Screens

### Login

Allows approved users to access the system.

### Request Account

Allows staff to request access. The form collects identity, office, position, reason for access, remarks, and optional attachments.

### Admin Dashboard

Shows pending account requests, pending content reviews, recently approved items, and system activity.

### Account Requests Queue

Lists pending, approved, and rejected account requests. Admin can review details and take action.

### User Management

Admin can create users, assign offices, assign roles, activate, and deactivate accounts.

### Office Management

Admin can create and update office records.

### Content Review Queue

Shows submitted content waiting for review.

### Review Detail Page

Admin sees submitted content, current published content, attachments, submitter details, and review actions. Reject and Request Revision require an admin note.

### Office User Dashboard

Office user sees drafts, pending submissions, approved items, rejected items, and items needing revision.

### Content Editors

Separate or type-aware forms for:

- Citizen's Charter service
- FAQ
- Event
- Project
- Program
- Activity

### Submission History

Shows past submissions, statuses, admin notes, and review dates.

### Attachments Panel

Allows users to upload and view supporting documents linked to account requests or content submissions.

## Chatbot Integration

The chatbot should query a published-content interface instead of reading all records.

Rules:

- Only `Published` Citizen's Charter service records are searchable by service matching.
- Only active, published FAQ records are searchable as FAQ answers.
- Pending Review, Needs Revision, Rejected, Draft, and Archived records are excluded.
- If the database is unavailable, the chatbot should fail safely with a handoff message or use the last known published cache.

The existing `data/services.json` can be imported into the database as initial published Citizen's Charter service records.

## Error Handling And Safety

- Reject or revision actions require admin notes.
- Office users cannot edit another office's records.
- Users cannot publish their own submissions unless they have admin permissions.
- File uploads should validate type and size.
- Every review action should be recorded with reviewer and timestamp.
- Published content should not change until approval succeeds.
- If approval fails midway, the previous published version remains active.

## Testing Strategy

Test these workflows:

- Staff can submit an account request.
- Admin can approve or reject account requests.
- Rejection requires an admin note.
- Admin can create and deactivate users.
- Office user can submit content for their assigned office.
- Office user cannot edit another office's content.
- Admin can approve, reject, and request revision on content.
- Reject and Request Revision require notes.
- Published content stays live while edits are pending.
- Chatbot reads only published Citizen's Charter and FAQ records.
- Attachments link correctly to requests and submissions.

## Open Implementation Decisions

These can be decided during implementation planning:

- Exact web framework.
- Database provider.
- File storage provider.
- Authentication provider.
- Whether content comparison/diff highlighting is in version one or a later enhancement.
