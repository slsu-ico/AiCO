const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createInitialSession,
  handleUserMessage,
} = require('../src/conversationEngine');

test('starts with requester type choices', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'hello');

  assert.equal(result.session.state, 'selecting_audience');
  assert.match(result.replies[0].text, /SLSU internal unit\/office/i);
  assert.deepEqual(
    result.replies[0].quickReplies.map((reply) => reply.payload),
    ['AUDIENCE_INTERNAL', 'AUDIENCE_EXTERNAL']
  );
});

test('shows internal services after internal audience selection', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'AUDIENCE_INTERNAL');

  assert.equal(result.session.audience, 'internal');
  assert.equal(result.session.state, 'selecting_service');
  assert.equal(result.replies[0].quickReplies.length, 7);
  assert.ok(result.replies[0].text.includes('Provision of training and/or speakership'));
});

test('shows external services after external audience selection', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'external partner');

  assert.equal(result.session.audience, 'external');
  assert.equal(result.replies[0].quickReplies.length, 2);
  assert.ok(result.replies[0].text.includes('Request for documentation services'));
});

test('renders a service guide when a service is selected', () => {
  const session = {
    state: 'selecting_service',
    audience: 'internal',
  };
  const result = handleUserMessage(session, 'SERVICE_internal-posting-email-blast');

  assert.equal(result.session.state, 'viewing_service');
  assert.match(result.replies[0].text, /Request for posting and\/or email blast/);
  assert.match(result.replies[0].text, /https:\/\/bit\.ly\/DisseminationRequestICO/);
  assert.match(result.replies[0].text, /Fees: None/);
  assert.match(result.replies[0].text, /Processing time: 30 minutes/);
});

test('matches free-text questions to a service guide', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'I need an AVP for our event');

  assert.equal(result.session.state, 'viewing_service');
  assert.match(result.replies[0].text, /Request for audiovisual production/);
  assert.match(result.replies[0].text, /https:\/\/bit\.ly\/AVPRequestICO/);
});

test('hands off when free text is outside the charter', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'How do I enroll as a first year student?');

  assert.equal(result.session.state, 'handoff');
  assert.match(result.replies[0].text, /I can only confirm details listed in the ICO Citizen's Charter/);
  assert.ok(result.replies[0].quickReplies.some((reply) => reply.payload === 'BACK_TO_START'));
});
