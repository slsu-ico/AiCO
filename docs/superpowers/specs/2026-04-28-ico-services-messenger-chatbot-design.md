# ICO Services Messenger Chatbot Design

Date: 2026-04-28

## Source

This design is based on the ICO Citizen's Charter 2026 PDF provided by the user:

`C:\Users\Ranj\Downloads\ICO Citizen's Charter 2026.docx.pdf`

The chatbot will treat the Citizen's Charter as the authoritative source for ICO service information during the trial.

## Goal

Establish one ongoing trial project for chatbot utilization on social media, starting with Facebook Messenger. The chatbot will help users understand and access ICO services listed in the Citizen's Charter.

The trial will use a hybrid model:

- Scripted official service flows for predictable, high-confidence guidance.
- AI-assisted free-text fallback for user questions that can be answered from the structured Citizen's Charter data.
- Human handoff or contact guidance when a question is unclear, outside the charter, sensitive, or requires staff judgment.

## Scope

The first trial targets Facebook Messenger.

The chatbot will not replace official Job Order forms or approve requests. It will guide users to the correct ICO service, explain requirements and timelines, and provide the official request link.

### External Services

1. Request for layout of IEC materials
2. Request for documentation services

### Internal Services

1. Provision of training and/or speakership
2. Request for layout of IEC materials
3. Request for article and/or report writing
4. Request for posting and/or email blast
5. Request for audiovisual production
6. Request for documentation services
7. Request review of layout and/or write-up

## Conversation Flow

The chatbot starts with a greeting and asks the user to identify their requester type:

1. SLSU internal unit/office
2. External partner

After the user selects the requester type, the bot shows only the services relevant to that audience.

When the user chooses a service, the bot presents a step-by-step guide containing:

- What the service is for
- Who may avail
- Requirements
- Submission timeline and deadline reminders
- Official request link
- Fees
- Processing time
- Client Satisfaction Survey reminder

The user can return to the service list, ask a free-text question, or request handoff/contact guidance.

## Knowledge Base

The Citizen's Charter will be converted into structured service records. For the trial, this can start as an editable JSON or CSV file in the project.

Each service record should include:

- `audience`: `internal` or `external`
- `service_name`
- `description`
- `office_or_unit`
- `classification`
- `transaction_type`
- `who_may_avail`
- `requirements`
- `submission_timeline`
- `official_link`
- `fees`
- `processing_time`
- `css_reminder`
- `handoff_notes`

Scripted replies and AI fallback responses will both use this structured knowledge base so that the chatbot has one source of truth.

## Technical Architecture

The trial system will have three main layers.

### Messenger Connector

The connector receives Facebook Messenger webhook events from Meta, verifies webhook requests, and sends replies back through Messenger.

It should support:

- Greeting messages
- Quick replies
- Button-style service choices
- Free-text message handling
- Handoff/contact prompts

### Conversation Engine

The conversation engine tracks each user's current state:

- Greeting
- Audience selection
- Service selection
- Service guide display
- Free-text fallback
- Handoff/contact guidance

For the trial, session storage can start lightweight. If the trial grows, conversation sessions can move to a database.

### ICO Service Knowledge Base

The knowledge base stores the structured service records extracted from the Citizen's Charter. The scripted flow reads directly from these records. The AI fallback retrieves the most relevant service record before answering.

## AI Fallback Guardrails

The AI fallback must be narrow and cautious.

It may:

- Answer questions using only the structured Citizen's Charter records.
- Clarify which ICO service best matches the user's question.
- Summarize requirements, timelines, fees, links, and processing time from the matching service record.
- Suggest handoff when the answer is not clearly available.

It must not:

- Invent requirements, deadlines, fees, availability, or policy exceptions.
- Approve requests.
- Promise that ICO staff will accept a late or incomplete request.
- Answer from general internet knowledge.
- Modify official Citizen's Charter information.

When confidence is low, the chatbot should respond with a safe message such as:

"I can only confirm details listed in the ICO Citizen's Charter. I can help you find the closest ICO service or guide you to contact ICO staff."

## Handoff

The handoff path should appear when:

- The user asks something outside the Citizen's Charter.
- The user requests policy interpretation or approval.
- The user asks about late, urgent, or exceptional requests.
- The bot cannot confidently match the message to a service.
- The user explicitly asks to talk to ICO staff.

The handoff response should provide the closest relevant service, official link when available, and instructions to contact ICO through the official website or ICO Facebook page. If ICO wants a specific email, phone number, or staff inbox for handoff, that contact detail should be added before launch.

## Testing

Testing should verify:

- Messenger webhook verification works.
- Messenger messages are received and replies are delivered.
- Internal and external branching shows the correct service list.
- Every service menu item returns the correct guide.
- Official links and timelines match the Citizen's Charter.
- Fees are shown as none where listed.
- Free-text questions match the correct service when possible.
- Out-of-scope free-text questions trigger handoff.
- The AI fallback does not hallucinate requirements, fees, or deadlines.

## Trial Success Measures

The trial should track:

- Number of conversations handled
- Most selected services
- Number of free-text questions
- Number of handoffs
- Common unanswered questions
- Staff feedback on answer accuracy
- Whether users reach the correct request form faster

## Open Launch Decisions

Before implementation or deployment, ICO should confirm:

- The final service contact/handoff details.
- Whether the editable knowledge base should be JSON, CSV, or Google Sheets.
- The exact hosting target for the Messenger webhook.
- Whether the first version should use an AI provider immediately or launch scripted first with AI fallback added after content validation.
