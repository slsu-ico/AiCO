# Standalone SLSU ICO Facebook chatbot

Date: 2026-10-26
Status: Approved by user on 2026-10-26

## Confirmed intent

Create a separate ICO-only chatbot deployed only to the SLSU ICO Facebook Page. It explains ICO services and guides users to official request forms. It does not collect or submit service requests. This supersedes the earlier proposal to extend the existing AiCO application. The user subsequently approved replacing the external AI interpreter with menus and controlled keyword matching: no external AI API, model, or model credentials.

## Approach

The user selected a separate application over extending the existing AiCO server. Build an independently runnable project in `ico-facebook-chatbot/`, with its own dependencies, tests, configuration example, and deployment instructions. The existing AiCO server and admin portal remain outside its runtime and deployment.

Use a minimal Node.js CommonJS application, consistent with the repository's existing language. This is a proposed implementation choice. The application handles Messenger webhooks and outbound replies; it needs neither an agent framework nor a public chat website. A dedicated environment and Page credential prevent it from sharing the existing application's deployment. Reusing reviewed implementation patterns is acceptable; importing parent application runtime modules is not.

## Channel and Page isolation

The application serves a webhook endpoint and a minimal health endpoint. There is no browser chat interface or admin portal. Deploying a Messenger webhook requires a publicly reachable HTTPS server; users interact with it through the ICO Page's Messenger conversation.

Require an explicitly configured ICO Facebook Page ID. Accept only Page webhook entries for that ID and recipient IDs matching it. Ignore events from other Pages, message echoes, delivery receipts, and unsupported event types. Send replies using the dedicated ICO Page access token. Validate Meta request signatures against the original request bytes using the configured app secret. Limit webhook body size, validate incoming event shapes, and verify subscription challenges with a secret verification token.

## Approved knowledge

Update from user-provided screenshots and process PDF on 2026-10-26: the current catalog contains ten services (E1-E2 and S1-S8). S8, Request for Photo/Video Assets, uses the shown asset-type, purpose/intended-use, and asset-description fields, plus the form's copyright reminder. Use the supplied respondent form URL. Process document PMC-ICO-3.01 (revision 0, July 1, 2025) establishes eligibility for internal and external stakeholders, a completed online Job Order form followed by email/Messenger notification to ICO, 5/15/5-minute listed activities (25 minutes by addition), three-day asset access, and the Client Satisfaction Form. Keep the three-day access window distinct from activity durations. Use shared eligibility for this single record while retaining its S8 internal catalog grouping. The user subsequently confirmed all ICO services currently have no fees. Service classification and advance submission deadlines remain unspecified.

Maintain a small, version-controlled ICO-only service JSON file within the standalone project, initially derived from the existing nine ICO service records. It includes internal and external services, eligibility, requirements, submission reminders, fees, processing time, official request links, and approved contact guidance. Changes are reviewed as file changes and deployed; this release does not add content administration or depend on the existing application's PostgreSQL data.

The supplied Google Forms respondent and editor links have not been readable with the available tools, and their service mapping remains unverified. Retain existing service links until that mapping is verified. Never publish the editor URL to users, assume the two URLs represent the same form, or invent form fields. Validate allowed respondent form URL shapes and exclude editor URLs from user-facing knowledge and output.

## Conversation

Introduce the bot as the ICO services assistant. Offer service choices and internal/external audience clarification where needed. Let people describe a request in English or Filipino. Ask a clarifying question when multiple services fit. Once a service is identified, explain the requested published details and include its official form link. Resolve follow-ups such as "Where is the form?" using the last selected service.

For unrelated questions, explain the ICO-only scope and offer the service menu. For unknown ICO facts, approvals, exceptions, urgent-request decisions, and request status, provide approved ICO contact guidance. Never claim a request was approved, submitted, tracked, or forwarded to staff. The user completes the form outside Messenger.

## Rules-based behavior (approved replacement for external AI)

Use a local deterministic interpreter with service aliases, exact service/menu choices, a controlled query vocabulary, and supported information fields. It returns a validated service selection, clarification, scope refusal, or staff contact decision. Application code renders approved record values and official form links. It does not generate prose, browse the web, or send questions to an external AI provider.

Service codes E1-E2/S1-S8 and menu numbers select exact records. Common English/Filipino service and field phrases support short questions and follow-ups. Ambiguous service/audience matches require clarification. Unrecognized wording falls back to the service menu or ICO contact guidance rather than a guessed answer. This is a rules-based assistant, not a trained general language model; broad paraphrase understanding is a non-goal.

Remove the external AI adapter and its environment settings entirely. Ignore stale AI variables in host configuration so they cannot enable provider calls. Keep input/context/output limits, signature checks, and Page restrictions. Meta and Redis remain necessary for Messenger delivery and state; cloud hosting costs remain even though there are no AI API charges.

## Delivery and state

Use a dedicated Redis instance or namespaced Redis keys for short-lived conversation state, event deduplication, and a durable inbound work queue. Validate and persist supported events before acknowledging the webhook; if durable enqueueing fails, return a retryable error rather than acknowledge and lose the message. A worker processes queued events using local rules and sends Messenger replies with bounded retries and per-user ordering. This separates Meta acknowledgement timing from outbound delivery latency. Document that network failures around outbound sends can still cause duplicate replies; do not promise exactly-once external delivery.

Deploy the webhook and worker as the standalone application's own service on a host supporting an always-running Node.js process, with managed Redis and public HTTPS. Include a Dockerfile and health check for portability. Choose a concrete hosting provider only when deployment access is available; do not change the existing Vercel project or assume serverless requests can run a persistent worker.

## Verification and deliverables

Provide source code, ICO knowledge JSON, configuration example, Dockerfile, automated tests, and a README covering local startup and ICO Page setup. Test Page isolation, webhook verification, raw-body signatures, event filtering, durable acknowledgement, retries/deduplication, per-user state, service menus, audience ambiguity, contextual form links, out-of-scope requests, instruction-override attempts, no outbound interpreter requests, and editor-link exclusion. Exercise the real local matcher; inject Messenger responses only at the external boundary. Verify the container/startup behavior where tooling permits.

Live deployment requires access to the chosen hosting service, managed Redis, the ICO Page ID and Page access token, Meta app secret and webhook verification token. No AI credential is required. Do not ask the user to paste secrets into chat. Configure them through the host's protected secret settings when available. Meta webhook registration and live Page message testing remain separate from local verification and must be reported accurately.

## Non-goals and implementation choices

No integration with the current AiCO admin portal or database, public web chat, personal Facebook account automation, other Pages, form submission, request intake, attachment collection, external AI calls, or general-purpose question answering. Preserve unrelated local changes. The builder chooses module layout, rule organization, queue library, validated decision schema, limits, and retry intervals. Production service records and form mapping require ICO verification before launch; the app can be implemented and tested with the supplied records in the meantime.
