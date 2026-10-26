# SLSU ICO Facebook chatbot

A standalone Facebook Messenger assistant for the **SLSU ICO Page only**. It explains approved ICO services and directs users to official request forms. It has its own deployment, configuration, dependencies, Redis keys, and bundled service records; it does not depend on the parent AiCO server or admin portal.

There is no public chat website. The public HTTPS endpoint receives Meta webhooks; conversations take place in the ICO Page's Messenger inbox.

## Answers and boundaries

- Ten service records cover two external services and eight internal services, including **S8: Request for Photo/Video Assets**. Review `data/services.json` with ICO before launch.
- Menus, requirements, fees, timelines, and form links use local rules and approved records. **No external AI provider, AI key, model downloads, or AI API charges are required.**
- Controlled English/Filipino keywords identify service choices and supported information fields. The application renders facts directly from the records; it does not generate answers, search the web, or send questions to an AI provider.
- Ambiguous requests prompt service/audience clarification. Follow-up form questions use the selected service.
- Other topics get an ICO-only scope reminder. Unlisted facts, approvals, exceptions, and request status receive ICO contact guidance.
- The bot guides users to forms. It does not submit forms, collect attachments, approve requests, or notify staff.

This is a rules-based service assistant, not a trained language model. Stored service facts are English; navigation and field labels support Filipino. The matcher deliberately supports a limited vocabulary. Unrecognized wording receives the ICO menu or contact guidance instead of a guessed answer. Test representative questions with ICO staff before opening the Page integration to everyone.

Users can tap a service, type its number from the currently displayed list, or use `E1`, `E2`, or `S1` through `S8`. Clarification lists show their own numbers; after a service guide, use the Services button to display the numbered menu again. Examples include `poster layout`, `photo coverage`, `email blast`, `Magkano po ang bayad sa photo assets?`, and follow-up questions such as `What are the requirements?`. If multiple services match, select from the offered choices. Service codes follow the supplied folder list and remain stable when a requester switches audiences.

Cloud hosting and Redis are still needed for always-online Messenger delivery. Removing the AI API does not remove those hosting requirements. Former AI environment variables are ignored and should be removed from deployment settings.

## Local setup

Use Node.js 24+, npm, and Redis 7+. Run commands from **this directory**:

```powershell
cd ico-facebook-chatbot
npm ci --ignore-scripts
Copy-Item .env.example .env
```

Edit `.env` with your ICO Page credentials. Do not paste secrets into chat or commit `.env`. Required settings:

| Setting                  | Purpose                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `ICO_PAGE_ID`            | Numeric ID of the ICO Facebook Page; foreign Page entries and recipient IDs are ignored.       |
| `PAGE_ACCESS_TOKEN`      | Access token for this ICO Page only.                                                           |
| `MESSENGER_APP_SECRET`   | Meta app secret for validating raw-body webhook signatures.                                    |
| `MESSENGER_VERIFY_TOKEN` | A long random secret used when registering the webhook.                                        |
| `META_GRAPH_VERSION`     | A supported version selected in your Meta app dashboard, such as `v24.0`; no implicit version. |
| `REDIS_URL`              | Dedicated Redis connection; prefer `rediss://` for managed Redis.                              |
| `PORT`                   | HTTP port, default `3000`.                                                                     |

Start only local Redis, then run Node:

```powershell
docker compose up -d redis
npm start
Invoke-WebRequest http://localhost:3000/health
```

Or start the standalone app and Redis together:

```powershell
docker compose up --build -d
Invoke-WebRequest http://localhost:3001/health
```

Compose exposes Redis and the app on loopback for local development. Redis uses a dedicated volume, AOF persistence, and `noeviction`. Do not delete the Redis volume while messages are pending.

## Independent deployment

1. Deploy **this directory** as a separate Docker service on a host that supports an always-running Node.js process. Build with `docker build -t slsu-ico-facebook-chatbot .` and run the resulting image with protected environment variables. The webhook and worker run in the same process. This is not a request-scoped serverless function.
2. Provision dedicated Redis 7+ with persistence enabled, `maxmemory-policy=noeviction`, sufficient storage, and private networking or TLS. Acknowledgement means Redis accepted the queue write; durability across a Redis host failure depends on the provider's persistence/replication guarantees.
3. Add the required settings using the host's protected secret/environment settings. Keep Page access tokens and Meta app secrets out of images, source, logs, and shared configuration exports. No AI credential is needed.
4. Expose the app through HTTPS and configure the host health check as `GET /health`. Readiness checks the worker and Redis. Allow a 50-second graceful shutdown period.
5. Register the HTTPS `/webhook` URL in the dedicated Meta app and verify it with `MESSENGER_VERIFY_TOKEN`. Use the app's current Messenger setup flow, subscribe to `messages` and `messaging_postbacks`, and subscribe only the ICO Page. Grant only the permissions required by that flow, including messaging access; complete Meta's applicable review/access requirements before serving users outside app roles.
6. Test from an authorized Facebook account: `hello`, a service choice, `Where is the form?`, an ambiguous layout request, an unrelated question, and an exception/status question. Confirm replies reach only the ICO Page conversation and that form links are correct.

Do not reuse the existing AiCO deployment or point the app at the parent application's content database. Choose the host and register the Page once deployment/account access is available. No hosting resources or Page subscriptions are created by installing this project.

## Processing and operational limits

Supported, signed Page events are durably queued before returning HTTP 200. Redis failure returns 503 so Meta can retry. Message/postback IDs produce stable job IDs. For a postback without an ID, the Page, sender, platform timestamp, and payload produce a stable hash; the local clock is never used for deduplication. Echoes, receipts, unsupported attachments, other Pages, and invalid recipients are ignored.

A globally serial BullMQ worker preserves conversational processing order across instances. Retries happen inside the active job, so another queued message cannot overtake a transient retry. This favors correctness over throughput; question matching runs locally and only delivery requires a Meta API call. Each job permits three persisted processing attempts, with short bounded backoff. Failed jobs remain visible in Redis for operator investigation; monitor the generic `message_failed`, `worker_error`, and Redis availability logs. There is no automatic human notification.

Rendered answers and the next unsent chunk are checkpointed in job data. A restart resumes that answer. The interval between Meta accepting a reply and saving its checkpoint can still produce a duplicate; exactly-once external delivery is not guaranteed. Events older than 23 hours are dropped to avoid replying after the standard Messenger response window. The bot does not use message tags or initiate later follow-up messages.

Session context expires after one hour. Completed and failed jobs retain their message/checkpoint data for roughly 24 hours, with BullMQ's lazy age cleanup on later job completion/failure. This is deduplication retention, not a permanent audit trail or a strict deletion deadline. Use a dedicated Redis retention/backup policy appropriate for ICO; provider backups may retain data longer. A changed Page ID creates a separate key namespace.

Incoming bodies are capped at 256 KiB, supported messages at 2,000 UTF-16 code units, and outgoing chunks at 1,800. Oversized messages are ignored. Questions are interpreted in the chatbot process and stored in the Redis queue for delivery/recovery; no questions are sent to an AI provider. Meta receives the replies for the Messenger conversation. Upstream error bodies and message contents are not logged.

## Content and supplied forms

Edit `data/services.json`, review the changes with ICO, run tests, and redeploy. Knowledge validation rejects malformed/non-ICO records, duplicate IDs, and editor URLs. Facts remain exactly as recorded; check the initial timelines and requirements against the latest approved ICO charter before launch.

S8 combines the supplied form screenshot with the user-provided process document, `02 Request for Photo or Video Assets.docx.pdf` (PMC-ICO-3.01, revision 0, effective July 1, 2025). Although filed as internal service S8, its documented scope includes **all stakeholders, including internal and external units**. The catalog still contains ten service records; shared eligibility does not create an eleventh service.

The form asks for asset type (Photos, Videos, and/or Drone Shots), purpose/intended use, and a description identifying the person, event, or location. It notes copyright restrictions and possible sanctions for use beyond the stated purpose. The process requires a completed online Job Order form followed by notification to `reports@slsu.edu.ph` or Messenger `@slsuico`. ICO acknowledges and assesses the request, provides **three-day access**, and requests the Client Satisfaction Form. The listed activity durations are 5 + 15 + 5 = **25 minutes**; three days is the access window, not a processing deadline or a guaranteed response time. All ten services currently have no fees, as confirmed by the user on October 26, 2026. Advance submission deadlines and service classification remain unspecified.

The supplied respondent link is used for S8; the supplied editor URL is never presented to users. Other services retain their existing links pending verification.

## Verification

```powershell
npm run ci
npm audit --omit=dev
```

To run the real Redis integration tests, point **TEST_REDIS_URL** to a disposable test instance, then run tests:

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379'
npm test
```

Integration tests create randomized test namespaces and delete only their own test queues. Without `TEST_REDIS_URL`, two Redis integration tests are explicitly skipped. The repository's dedicated workflow runs them against Redis and builds the Docker image. Conversation tests exercise the real local matcher, including a check that matching performs no HTTP calls. Messenger tests inject external API responses; they do not prove Meta app permissions or real Page delivery.

## Primary references

- [Meta Messenger documentation](https://developers.facebook.com/docs/messenger-platform/)
- [Meta webhook setup](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- [BullMQ global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency)
- [BullMQ Redis connections and persistence](https://docs.bullmq.io/guide/connections)
