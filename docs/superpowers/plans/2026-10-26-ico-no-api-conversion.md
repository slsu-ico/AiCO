# ICO No-API Conversion Plan

Approved scope: replace the standalone bot's external AI interpreter with menus and controlled keyword matching. Keep the ten approved service records, shared S8 eligibility, Page isolation, official forms, Redis delivery, and existing deployment model.

## Implementation

- [x] Add failing end-to-end conversation tests for local service matching, S1-S8/E1-E2 and number selection, field follow-ups, ambiguity, unrelated keyword overlap, unsupported facts, and no outbound model requests.
- [x] Add a deterministic rule interpreter using service aliases, an allowed query vocabulary, field intents, and explicit staff-referral patterns. Preserve candidate context; unsupported language receives the menu/contact guidance.
- [x] Wire the local interpreter as the default. Remove the external AI adapter, model settings and environment variables. Retain only Messenger network calls and Redis connections.
- [x] Update tests and README/setup examples to describe a rules-based assistant, no external AI charges or model credentials, conservative language support, and ongoing cloud hosting needs.
- [x] Run standalone formatting, lint and full tests. Request independent review of the scope matcher and no-provider wiring; fix material findings with regression tests.

The user's yes approves this conversion. Implement inline in the existing separate project folder; preserve unrelated working changes.
