# SLSU ICO-only AI form guide

Date: 2026-10-26
Status: Superseded by 2026-10-26-standalone-ico-facebook-chatbot-design.md following the user's separate-application requirement.

## Intent and confirmed scope

Extend the existing AiCO chatbot to help people understand SLSU Information and Communications Office (ICO) services and reach the appropriate official request form. The user confirmed that the chatbot guides users to forms rather than collecting or submitting requests.

Success means a user can describe their ICO request, receive the relevant approved requirements and submission reminders, and open the correct official form. The chatbot must remain useful when AI is unavailable.

## Current project

The application is a CommonJS Node.js server with Messenger integration, an authenticated chatbot preview, PostgreSQL content publishing, Redis caching, and nine seed service records. Messenger and preview use the same conversation engine. The engine currently returns service guides and FAQs using keyword matching; AI_FALLBACK_ENABLED is an unused example setting. Keyword overlap can select a service without establishing that the question is actually in scope.

Production answers must continue to use active published records. Seed JSON is for the existing seed/offline paths, not a substitute when production published content is empty or unavailable.

## Approaches

1. Extend the existing engine with constrained AI interpretation and deterministic answers (recommended). Reuses the existing content approval workflow and channels. The model interprets questions; application code renders approved facts and links.
2. Keep keyword matching only. Requires no model account, but handles ambiguous natural-language questions poorly and does not deliver the requested AI capability.
3. Build a separate agent application. Duplicates the existing administration, content, and Messenger integration without improving the requested form guidance.

Only the first approach fits both the AI request and the existing project without replacing working infrastructure. This is the proposed implementation choice, pending approval.

## Conversation behavior

- Introduce AiCO as a guide limited to SLSU ICO services; retain service menu navigation.
- Accept English and Filipino questions and use the existing locale behavior.
- Ask which audience applies when both internal and external records fit. Do not silently select an external service for an internal requester or the reverse.
- Ask a service clarification when several services fit, especially documentation versus audiovisual production.
- Explain only the requested published facts: eligibility, requirements, submission reminders, fees, processing time, and official request link. General service selections may still display the full service guide.
- Resolve short follow-up questions such as "Where is the form?" against the last selected service. If no service is selected, ask the user to choose one.
- Include the official form link in relevant service guidance, with a clear instruction to complete the request on the official form.
- Explain that unrelated topics fall outside ICO services and offer the service menu. Unknown ICO facts and requests for staff decisions receive contact guidance using the existing contact information; do not claim that a staff member was notified.
- Never approve a request, promise an exception, invent a requirement, or claim a form was submitted or a request status was checked.

## AI boundary and implementation

Preserve the existing Node.js stack. Add an asynchronous orchestration layer shared by Messenger and the authenticated preview, keeping existing explicit menu payload handling deterministic.

For natural-language questions, supply a bounded conversation context and the current published service/FAQ records to an AI adapter. Treat user messages and record text as data. The model returns a validated structured decision: answer from specified service IDs and allowed fields, answer from specified FAQ IDs, clarify among candidate services, decline out-of-scope input, or refer an unsupported question to ICO staff.

The model does not produce the user-facing factual answer. Application code validates every selected record and field against the current published snapshot and renders the approved content. Links come from the selected service record, never from model output. IDs for FAQs may be assigned within each snapshot when records lack stable IDs. Invalid IDs, malformed responses, unsupported decisions, timeouts, and provider failures use the existing service menu/contact fallback. Do not present low-confidence keyword overlap as an authoritative answer after an AI failure.

Use a configurable server-side model adapter, with Vercel AI Gateway as the proposed default because the project already has Vercel deployment support. No framework migration is needed. Document model configuration and local setup; use the existing managed-secret mechanism for production credentials. AI remains optional so the current menu flow works without model credentials. Configure a bounded input size, output size, and request timeout, with injected adapter support for tests. Send only the question, necessary service context, and approved content to the model; no Messenger sender IDs or account details.

The current published-content SQL filters publication status but does not filter office ownership. Restrict chatbot services and FAQs to records owned by an active office whose abbreviation is ICO, matching the existing seed office identifier. Join offices through content_items.office_id; do not infer ownership from editable service descriptions. Use ICO-specific, versioned cache keys so old all-office Redis entries and process-local stale snapshots cannot leak into the restricted loader. Apply this restriction to both normal loads and cache warming. Keep other offices' admin records intact. Do not add an AI-based publication workflow or broaden which offices can publish content in this change.

## Official forms

The user supplied these URLs:

- Respondent link: https://docs.google.com/forms/d/e/1FAIpQLSdl6Lp5X68NWAcGQvm_AMFGJ4-WFVd-BuHBX9iX4dP4ipYpJQ/viewform
- Editor link: https://docs.google.com/forms/d/1gzNUqmIvmToJwg04fIKGummgil1HEVX6-t0wUC6kaHY/edit

Neither form could be read with the available web/browser tools during initial exploration. Their relationship to individual services is unverified. Existing records contain official form links; preserve these until a form's purpose and service mapping are verified. Never show the editor link to chatbot users, infer that these two URLs refer to the same form, or invent form field instructions. New field-specific FAQs can be published after the form contents are verified.

## Non-goals and constraints

No form submission, request intake, attachment collection, request tracking, staff approvals, general-purpose chat, web search by the chatbot, new public chat website, or UI redesign. Preserve existing admin publication, Messenger payload compatibility, session storage, and unrelated local changes.

This design specifies a behavior boundary and source-constrained rendering, not a promise that an AI classifier can never misinterpret a question. Verification must include adversarial and ambiguous examples, and uncertain cases should clarify or decline.

## Verification

Add meaningful tests for internal/external ambiguity, service clarification, contextual form follow-ups, unrelated questions containing ICO keywords, prompt-injection attempts, unpublished or non-ICO content isolation, exact published links, editor-link exclusion, and unsupported approval/status questions. Test invalid model decisions and unavailable/slow providers. Test that both Messenger and preview invoke the same orchestrator and preserve existing menu behavior. Run repository formatting, lint, and tests after implementation. Live model and Messenger verification require configured credentials and must be reported separately from mocked integration tests.

## Decisions left to implementation

Choose module names, the exact structured schema, a suitable supported model, bounded timeout/token limits, and the smallest adapter dependency footprint after checking current primary documentation. Resolve minor rendering details using the current UI and Messenger limits. Actual form-to-service mapping remains pending evidence, not an assumption to settle in code.
