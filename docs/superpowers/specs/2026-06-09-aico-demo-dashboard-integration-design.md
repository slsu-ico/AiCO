# AiCO Demo Dashboard Integration Design

## Goal

Incorporate the `aico_demo_v3.html` dashboard layout and chatbot demo into the existing AiCO server-rendered application without changing the app framework.

## Approved Approach

Use the demo file as a visual and interaction reference, then rebuild the relevant pieces natively in the current Node HTML rendering layer. The live admin portal should feel like the demo while preserving existing routes, CSRF protection, role gates, forms, links, and tests.

## Scope

- Refresh the shared admin shell in `src/layout.js` with the demo-inspired dark green sidebar, compact brand block, signed-in user block, grouped navigation, gold active marker, topbar, and dense white workspace.
- Replace the admin dashboard table in `renderAdminDashboard` with metric tiles for pending account requests, pending content reviews, and published records.
- Bring existing admin lists, filters, modals, forms, status labels, and tables into the same compact dashboard visual language.
- Add a chatbot demo page that mirrors the demo tab's chat panel: assistant header, message bubbles, quick replies, input row, reset action, and local in-browser conversation behavior.
- Add navigation to the chatbot demo from the authenticated app shell.

## Out Of Scope

- Rewriting the project as React or Vite.
- Replacing the production Messenger webhook.
- Persisting demo chat messages to the database.
- Changing account approval, content review, publication, upload, cache refresh, or user management behavior.

## UX Details

The refreshed shell uses SLSU green as the sidebar anchor, gold for active markers and small badges, white content surfaces, subtle borders, compact typography, and table-first admin workflows. The dashboard uses three action-oriented metric tiles above a recent operational summary. Existing list pages retain their current URLs and server-rendered forms but gain the same compact controls, status badges, and surface treatment.

The chatbot demo route is a safe simulator. It runs entirely in the browser, seeded with a short welcome message and quick replies for common ICO service requests. Sending text appends a user bubble and returns a canned assistant response based on simple keyword matching. Reset restores the initial state.

## Accessibility And Safety

- Keep semantic links, buttons, labels, tables, and forms.
- Preserve the skip link and responsive mobile behavior.
- Escape server-rendered content through existing helpers.
- Keep CSRF inputs in all protected POST forms.
- Avoid inline user data in scripts.

## Testing

- Add view tests for the dashboard metric-tile markup and chatbot demo escaping/static structure.
- Add route tests proving authenticated users can open the chatbot demo page.
- Update layout/navigation tests for the added demo link and grouped shell structure.
- Run the targeted Node tests, then the full test suite if targeted checks pass.
