# ICO Services Messenger Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Facebook Messenger webhook trial bot for ICO Citizen's Charter services.

**Architecture:** A dependency-light Node.js app exposes Messenger webhook endpoints, uses a structured ICO service knowledge base, and routes users through audience selection, service menus, service guides, free-text matching, and guarded handoff. Core behavior is implemented in pure modules with Node's built-in test runner.

**Tech Stack:** Node.js 24, CommonJS modules, built-in `node:http`, built-in `node:test`, JSON knowledge base.

---

### File Structure

- Create: `package.json` for scripts and project metadata.
- Create: `.env.example` for Messenger and optional AI configuration names.
- Create: `README.md` with local run, webhook setup, and test instructions.
- Create: `data/services.json` containing ICO service records from the charter.
- Create: `src/config.js` for environment configuration.
- Create: `src/serviceRepository.js` for loading and searching service records.
- Create: `src/conversationEngine.js` for scripted flow, free-text fallback, and handoff logic.
- Create: `src/messengerApi.js` for Facebook Send API payload delivery.
- Create: `src/server.js` for webhook verification and event handling.
- Create: `test/serviceRepository.test.js` for service lookup behavior.
- Create: `test/conversationEngine.test.js` for conversation behavior.
- Create: `test/server.test.js` for webhook verification and message handling.

### Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Create project metadata**

Add `package.json` with scripts:

```json
{
  "name": "ico-services-messenger-chatbot",
  "version": "0.1.0",
  "description": "Facebook Messenger chatbot trial for SLSU ICO Citizen's Charter services.",
  "main": "src/server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=24"
  }
}
```

- [ ] **Step 2: Add environment example**

Add `.env.example`:

```env
PORT=3000
MESSENGER_VERIFY_TOKEN=replace-with-a-random-verify-token
PAGE_ACCESS_TOKEN=replace-with-your-facebook-page-access-token
AI_FALLBACK_ENABLED=false
```

- [ ] **Step 3: Add README instructions**

Add commands for running tests, starting locally, and configuring Meta webhook callbacks.

### Task 2: Service Knowledge Base

**Files:**
- Create: `data/services.json`
- Create: `src/serviceRepository.js`
- Test: `test/serviceRepository.test.js`

- [ ] **Step 1: Write failing repository tests**

Tests should prove the repository loads services, filters by audience, finds by id, and searches free text.

- [ ] **Step 2: Run repository tests and confirm failure**

Run: `npm test -- test/serviceRepository.test.js`

Expected: FAIL because `src/serviceRepository.js` does not exist.

- [ ] **Step 3: Add `data/services.json`**

Create one record per charter service with `audience`, `id`, `service_name`, `description`, `office_or_unit`, `classification`, `transaction_type`, `who_may_avail`, `requirements`, `submission_timeline`, `official_link`, `fees`, `processing_time`, and `css_reminder`.

- [ ] **Step 4: Implement repository**

Expose `loadServices`, `getServicesByAudience`, `findServiceById`, and `searchServices`.

- [ ] **Step 5: Run repository tests and confirm pass**

Run: `npm test -- test/serviceRepository.test.js`

Expected: PASS.

### Task 3: Conversation Engine

**Files:**
- Create: `src/conversationEngine.js`
- Test: `test/conversationEngine.test.js`

- [ ] **Step 1: Write failing conversation tests**

Tests should prove greeting, internal/external branching, service guide rendering, free-text matching, and handoff behavior.

- [ ] **Step 2: Run conversation tests and confirm failure**

Run: `npm test -- test/conversationEngine.test.js`

Expected: FAIL because `src/conversationEngine.js` does not exist.

- [ ] **Step 3: Implement conversation engine**

Expose `createInitialSession` and `handleUserMessage`. Return Messenger-friendly response objects with `text` and optional `quickReplies`.

- [ ] **Step 4: Run conversation tests and confirm pass**

Run: `npm test -- test/conversationEngine.test.js`

Expected: PASS.

### Task 4: Messenger Webhook Server

**Files:**
- Create: `src/config.js`
- Create: `src/messengerApi.js`
- Create: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: Write failing server tests**

Tests should prove webhook verification succeeds with the correct token, fails with the wrong token, and POST events call the reply sender.

- [ ] **Step 2: Run server tests and confirm failure**

Run: `npm test -- test/server.test.js`

Expected: FAIL because `src/server.js` does not exist.

- [ ] **Step 3: Implement config, Messenger sender, and HTTP server**

Implement `createServer({ verifyToken, pageAccessToken, services, sendMessage })` for testability. The live `startServer` should listen on `PORT`.

- [ ] **Step 4: Run server tests and confirm pass**

Run: `npm test -- test/server.test.js`

Expected: PASS.

### Task 5: Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Start local server**

Run: `npm start`

Expected: server logs the local URL and webhook path.

- [ ] **Step 3: Document trial next steps**

Update `README.md` with Meta app setup notes: create a Meta app, add Messenger, set callback URL to `/webhook`, use the verify token, subscribe to messages, and deploy to an HTTPS host before live testing.

### Self-Review

- Spec coverage: The plan covers Facebook Messenger, structured service records, audience branching, step-by-step service guides, AI-style guarded free-text fallback without external AI dependency, handoff, and tests.
- Placeholder scan: No TBD/TODO/FIXME placeholders are intentionally left in the plan.
- Type consistency: Module names and exported functions are consistent across tasks.
