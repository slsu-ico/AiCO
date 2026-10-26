# Standalone ICO Facebook Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver an independently deployable, ICO-only Messenger chatbot that guides users to official forms.

**Architecture:** A standalone Node.js HTTP webhook validates Meta events and enqueues them in Redis using BullMQ. A globally serial worker interprets questions with a constrained AI adapter and renders answers from bundled ICO records. Redis stores sessions and durable processing checkpoints.

**Tech Stack:** Node.js 24 CommonJS, native fetch/HTTP/test, BullMQ, ioredis, Docker.

**Spec:** `docs/superpowers/specs/2026-10-26-standalone-ico-facebook-chatbot-design.md`

## Global Constraints

- Runtime lives entirely within `ico-facebook-chatbot/`; no parent runtime imports or existing deployment changes.
- Only the configured ICO Facebook Page is served. No public chat or admin UI.
- Approved ICO facts and respondent links come from standalone JSON. No model prose, editor links, form submission, or approvals.
- Persist supported events before acknowledging. Bound retries, provider calls, input and output. Keep menu guidance without AI credentials.
- Preserve unrelated working changes. Live deployment and API checks require real configured credentials.

## Review Focus

- Mixed-Page batches: foreign entries must never enqueue, including forged recipient IDs.
- Partial sends followed by worker restart: resume the persisted answer without repeating already checkpointed chunks.
- Malformed model decisions: no unsupported field, ID, or prose reaches replies.
- Retry ordering: later messages cannot overtake the current job's retries.
- Arbitrary record text containing editor URLs: fail knowledge validation before startup.

### Task 1: Knowledge and conversation

**Files:** `ico-facebook-chatbot/data/services.json`, `src/knowledge.js`, `src/conversation.js`, `test/conversation.test.js`.

**Interfaces:** `loadKnowledge()` returns validated services; `createConversation({services,classify})` returns async `(session,message) => {session,replies}`. Session has locale, lastServiceId, audience, and optional candidate IDs. Replies are `{text,quickReplies?}`.

- [x] Write failing tests for menu, contextual form link, audience ambiguity, unknown facts, invalid/injected model output, Filipino navigation, and editor URLs in any text.
- [x] Run `node --test test/conversation.test.js`; confirm missing behavior fails.
- [x] Implement strict knowledge/link checks, deterministic menu/field rendering, validated decisions, bounded context, and safe fallbacks.
- [x] Run the focused suite; expect all tests passing.

### Task 2: AI and Messenger adapters

**Files:** `src/ai.js`, `src/messenger.js`, `src/config.js`, `test/adapters.test.js`.

**Interfaces:** `createClassifier(config,{fetchImpl})` produces async `({message,session,services}) => decision`; `createSender(config,{fetchImpl})` produces async `(senderId,reply) => void`; `getConfig(env)` validates startup settings. `splitReplies(replies)` returns Messenger-sized messages.

- [x] Write and run failing tests for structured requests, provider failure/timeout, no identity in model requests, chunk/quick-reply boundaries, sanitized errors, and missing required configuration.
- [x] Implement native HTTP adapters, schema, bounded response readers, configurable endpoint/model/version, and validated secret configuration.
- [x] Run both task suites; expect all tests passing.

### Task 3: Durable Page-only delivery

**Files:** `src/webhook.js`, `src/jobs.js`, `src/runtime.js`, `test/webhook.test.js`, `test/jobs.test.js`, `test/redis.integration.test.js`.

**Interfaces:** `createWebhook({config,enqueue,isReady})` returns HTTP handler; `createProcessor({conversation,send,getSession,saveSession,sleep})` returns BullMQ processor; `start(config)` starts HTTP and queue worker with graceful shutdown.

- [x] Write and run failing tests for signatures, body limits, mixed Page batches, event filtering, durable enqueue failure, retries and checkpoint resume, and session persistence.
- [x] Implement BullMQ job-ID deduplication and global concurrency one. Retry inside each job with persisted attempt counts so delayed retries cannot reorder messages. Checkpoint rendered reply chunks before delivery and after each successful send. Retain jobs for 24 hours and sessions for one hour.
- [x] Add Redis integration tests for concurrent duplicate enqueueing, real session state, startup health, and ordered worker processing. Run when Redis is available; otherwise explicitly report the gap.
- [x] Run all standalone tests; expect passing unit/integration coverage.

### Task 4: Packaging and final verification

**Files:** `package.json`, lockfile, `.env.example`, `.gitignore`, `.dockerignore`, `Dockerfile`, `compose.yaml`, `README.md`, standalone lint/format config and CI workflow.

- [x] Document exact local startup, managed Redis persistence/noeviction, protected environment settings, HTTPS deployment and Meta Page registration. Include current primary documentation links and unresolved form mapping.
- [x] Run standalone tests, lint and formatting, parent regression suite, dependency audit, and startup/health smoke checks. Build Docker if available.
- [x] Request fresh whole-change review; address material findings with regression tests before final verification.
- [x] Deliver source and setup instructions; distinguish implemented/tested code from unconfigured live deployment.

## Execution record

Implement inline in the approved separate project directory, then use one fresh reviewer. The current checkout is already on `agent/production-hardening`; do not switch branches or disturb existing staged work. A separate project directory bounds changes without moving user work. No commits or shared-branch changes are needed for delivery.
