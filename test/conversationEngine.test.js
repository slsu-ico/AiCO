const assert = require('node:assert/strict');
const test = require('node:test');

const { createInitialSession, handleUserMessage } = require('../src/conversationEngine');

test('starts with requester type choices', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'hello');

  assert.equal(result.session.state, 'selecting_service');
  assert.match(result.replies[0].text, /ICO services|Here are the ICO services/);
  // quickReplies are SERVICE_<id> payloads
  assert.ok(Array.isArray(result.replies[0].quickReplies));
});

test('renders a service guide when a service is selected', () => {
  const session = {
    state: 'selecting_service',
    audience: 'internal',
  };
  const result = handleUserMessage(session, 'SERVICE_internal-posting-email-blast');

  assert.equal(result.session.state, 'viewing_service');
  assert.match(result.replies[0].text, /Request for posting and\/or email blast/);
  assert.match(result.replies[0].text, /https:\/\/forms\.gle\/CsJsfxNxSFt4Swo38/);
  assert.match(result.replies[0].text, /Fees: None/);
  assert.match(result.replies[0].text, /Processing time: 30 minutes/);
});

test('matches free-text questions to a service guide', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'I need an AVP for our event');

  assert.equal(result.session.state, 'viewing_service');
  assert.match(result.replies[0].text, /Request for audiovisual production/);
  assert.match(result.replies[0].text, /https:\/\/forms\.gle\/CsJsfxNxSFt4Swo38/);
});

test('matches free-text service synonyms to the right service guide', () => {
  const session = createInitialSession();

  const documentationResult = handleUserMessage(session, 'Can ICO help with report writing?');
  const layoutResult = handleUserMessage(session, 'Can ICO help with design for our poster?');

  assert.equal(documentationResult.session.state, 'viewing_service');
  assert.match(documentationResult.replies[0].text, /Request for article and\/or report writing/);
  assert.equal(layoutResult.session.state, 'viewing_service');
  assert.match(layoutResult.replies[0].text, /Request for layout of IEC materials/);
});

test('uses Messenger-safe quick reply labels for service lists', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'hello');

  assert.ok(result.replies[0].quickReplies.length <= 13);
  assert.ok(result.replies[0].quickReplies.every((reply) => reply.title.length <= 20));
  assert.ok(result.replies[0].quickReplies.some((reply) => reply.title === 'Audiovisual'));
  assert.ok(
    result.replies[0].quickReplies.some(
      (reply) => reply.payload === 'SERVICE_internal-audiovisual-production',
    ),
  );
});

test('answers Tagalog greetings with Filipino chatbot copy', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'Kumusta po');

  assert.equal(result.session.state, 'selecting_service');
  assert.match(result.replies[0].text, /Narito ang mga serbisyo ng ICO/);
  assert.match(result.replies[0].text, /Pumili po ng serbisyo/);
});

test('answers published FAQs before handing off', () => {
  const session = createInitialSession();
  const faqs = [
    {
      question: 'Where can I get official templates?',
      answer: 'Email reports@slsu.edu.ph for official templates.',
    },
  ];
  const result = handleUserMessage(
    session,
    'I need the templates for social media posts',
    undefined,
    faqs,
  );

  assert.equal(result.session.state, 'viewing_faq');
  assert.match(result.replies[0].text, /Where can I get official templates\?/);
  assert.match(result.replies[0].text, /reports@slsu\.edu\.ph/);
});

test('hands off when free text is outside the charter', () => {
  const session = createInitialSession();
  const result = handleUserMessage(session, 'How do I enroll as a first year student?');

  assert.equal(result.session.state, 'handoff');
  assert.match(
    result.replies[0].text,
    /I can only confirm details listed in the ICO Citizen's Charter/,
  );
  assert.match(result.replies[0].text, /reports@slsu\.edu\.ph/);
  assert.match(result.replies[0].text, /https:\/\/www\.slsu\.edu\.ph/);
  assert.ok(result.replies[0].quickReplies.some((reply) => reply.payload === 'BACK_TO_START'));
});
