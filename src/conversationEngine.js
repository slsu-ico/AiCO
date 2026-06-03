const {
  findServiceById,
  getServicesByAudience,
  loadServices,
  searchServices,
  tokenize,
} = require('./serviceRepository');

/**
 * @typedef {object} BotSession
 * @property {string} state Current conversation state.
 * @property {string | null} audience Last matched service audience, when known.
 * @property {string | null} lastServiceId Last selected service id, when known.
 */

/**
 * @typedef {object} QuickReply
 * @property {string} title Messenger quick reply label.
 * @property {string} payload Payload sent back to the webhook when selected.
 */

/**
 * @typedef {object} BotReply
 * @property {string} text Message body sent to the user.
 * @property {QuickReply[]} [quickReplies] Optional Messenger quick replies.
 */

/**
 * @typedef {object} ChatbotAnalyticsEvent
 * @property {string} name Stable analytics event name.
 * @property {string} [reason] Handoff or failure reason.
 * @property {string} [question] User question or matched FAQ question.
 * @property {string} [serviceId] Matched service id.
 * @property {string} [serviceName] Matched service display name.
 * @property {string} [matchType] How the service was matched.
 */

/**
 * @typedef {object} ChatbotResult
 * @property {BotSession} session Updated conversation session.
 * @property {BotReply[]} replies Replies to send in order.
 * @property {ChatbotAnalyticsEvent[]} analytics Analytics events emitted by this turn.
 */

/**
 * @typedef {object} IcoService
 * @property {string} id Stable service id.
 * @property {string} service_name Display name from the Citizen's Charter.
 * @property {string} description Service description.
 * @property {string} audience Eligible audience key.
 * @property {string} office_or_unit Responsible office or unit.
 * @property {string} classification Service classification.
 * @property {string} who_may_avail Eligible requester description.
 * @property {string[]} requirements Required documents or inputs.
 * @property {string[]} submission_timeline Submission reminders.
 * @property {string} official_link Official request URL.
 * @property {string} fees Fee summary.
 * @property {string} processing_time Processing time summary.
 * @property {string} css_reminder Customer satisfaction survey reminder.
 */

/**
 * @typedef {object} FaqRecord
 * @property {string} question Published FAQ question.
 * @property {string} answer Published FAQ answer.
 * @property {string[]} [keywords] Optional search keywords.
 */

/**
 * Create a blank chatbot session.
 *
 * @returns {BotSession}
 */
function createInitialSession() {
  return {
    state: 'new',
    audience: null,
    lastServiceId: null,
  };
}

function quickReply(title, payload) {
  return { title, payload };
}

const SERVICE_QUICK_REPLY_LABELS = {
  'external-layout-iec-materials': 'Layout (Partner)',
  'external-documentation-services': 'Docs (Partner)',
  'internal-training-speakership': 'Training/Speaker',
  'internal-layout-iec-materials': 'Layout (SLSU)',
  'internal-writing-request': 'Writing',
  'internal-posting-email-blast': 'Posting/Email',
  'internal-audiovisual-production': 'Audiovisual',
  'internal-documentation-services': 'Documentation',
  'internal-review-layout-writeup': 'Review Material',
};

function serviceQuickReplyTitle(service) {
  const configured = SERVICE_QUICK_REPLY_LABELS[service.id];
  if (configured) return configured;
  return service.service_name.slice(0, 20).trim();
}

function servicePayload(service) {
  return `SERVICE_${service.id}`;
}

/**
 * Build a service-list reply for a specific audience.
 *
 * @param {string} audience Service audience key.
 * @param {IcoService[]} [services] Service records available to the chatbot.
 * @returns {BotReply}
 */
function serviceListReply(audience, services = loadServices()) {
  const matchingServices = getServicesByAudience(audience, services);
  const label = audience === 'internal' ? 'internal SLSU unit/office' : 'external partner';
  const lines = matchingServices.map((service, index) => `${index + 1}. ${service.service_name}`);

  return {
    text: [
      `Here are the ICO services for an ${label}:`,
      '',
      ...lines,
      '',
      'Please choose a service.',
    ].join('\n'),
    quickReplies: matchingServices.map((service) =>
      quickReply(serviceQuickReplyTitle(service), servicePayload(service)),
    ),
  };
}

function serviceListAllReply(services = loadServices()) {
  const lines = services.map((service, index) => `${index + 1}. ${service.service_name}`);

  return {
    text: ['Here are the ICO services:', '', ...lines, '', 'Please choose a service.'].join('\n'),
    quickReplies: services.map((service) =>
      quickReply(serviceQuickReplyTitle(service), servicePayload(service)),
    ),
  };
}

function listItems(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * Build the detailed service guide reply for a selected service.
 *
 * @param {IcoService} service Selected service record.
 * @returns {BotReply}
 */
function serviceGuideReply(service) {
  return {
    text: [
      service.service_name,
      '',
      service.description,
      '',
      `Office/unit: ${service.office_or_unit}`,
      `Classification: ${service.classification}`,
      `Who may avail: ${service.who_may_avail}`,
      '',
      'Requirements:',
      listItems(service.requirements),
      '',
      'Submission reminders:',
      listItems(service.submission_timeline),
      '',
      `Official link: ${service.official_link}`,
      `Fees: ${service.fees}`,
      `Processing time: ${service.processing_time}`,
      '',
      service.css_reminder,
    ].join('\n'),
    quickReplies: [
      quickReply('Back to services', 'BACK_TO_SERVICES'),
      quickReply('Start over', 'BACK_TO_START'),
      quickReply('Talk to ICO staff', 'HANDOFF'),
    ],
  };
}

function faqSearchText(faq) {
  return [faq.question, faq.answer, ...(Array.isArray(faq.keywords) ? faq.keywords : [])].join(' ');
}

function searchFaqs(query, faqs = []) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored = faqs
    .map((faq) => {
      const haystack = faqSearchText(faq).toLowerCase();
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { faq, score };
    })
    .filter((item) => item.score >= 1)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.faq);
}

function faqReply(faq) {
  return {
    text: [faq.question, '', faq.answer].join('\n'),
    quickReplies: [
      quickReply('Back to services', 'BACK_TO_SERVICES'),
      quickReply('Start over', 'BACK_TO_START'),
      quickReply('Talk to ICO staff', 'HANDOFF'),
    ],
  };
}

function handoffReply() {
  return {
    text: [
      "I can only confirm details listed in the ICO Citizen's Charter.",
      '',
      'For requests that need staff judgment, exceptions, approvals, or information outside the charter, please contact ICO directly:',
      '',
      'Email: reports@slsu.edu.ph',
      'Website: https://www.slsu.edu.ph',
      'Facebook: https://www.facebook.com/SLSUOFFICIAL',
    ].join('\n'),
    quickReplies: [
      quickReply('Back to start', 'BACK_TO_START'),
      quickReply('Internal services', 'AUDIENCE_INTERNAL'),
      quickReply('External services', 'AUDIENCE_EXTERNAL'),
    ],
  };
}

function normalizeMessage(message) {
  return String(message || '').trim();
}

function cloneSession(session) {
  return {
    ...createInitialSession(),
    ...session,
  };
}

function withAnalytics(result, analytics = []) {
  return {
    ...result,
    analytics,
  };
}

/**
 * Advance a chatbot session from one incoming user message.
 *
 * @param {Partial<BotSession>} session Existing session state.
 * @param {string} message Incoming text, quick reply payload, or postback payload.
 * @param {IcoService[]} [services] Service records available to the chatbot.
 * @param {FaqRecord[]} [faqs] Published FAQ records available to the chatbot.
 * @returns {ChatbotResult}
 */
function handleUserMessage(session, message, services = loadServices(), faqs = []) {
  const current = cloneSession(session);
  const input = normalizeMessage(message);

  if (!input || input === 'BACK_TO_START') {
    return withAnalytics({
      session: { ...createInitialSession(), state: 'selecting_service' },
      replies: [serviceListAllReply(services)],
    });
  }

  if (input === 'HANDOFF') {
    return withAnalytics(
      {
        session: { ...current, state: 'handoff' },
        replies: [handoffReply()],
      },
      [{ name: 'chatbot_handoff', reason: 'requested' }],
    );
  }

  if (input === 'BACK_TO_SERVICES' && current.audience) {
    return withAnalytics({
      session: { ...current, state: 'selecting_service' },
      replies: [serviceListAllReply(services)],
    });
  }

  if (input.startsWith('SERVICE_')) {
    const serviceId = input.slice('SERVICE_'.length);
    const service = findServiceById(serviceId, services);
    if (!service) {
      return withAnalytics(
        {
          session: { ...current, state: 'handoff' },
          replies: [handoffReply()],
        },
        [
          { name: 'chatbot_handoff', reason: 'service_not_found' },
          { name: 'chatbot_unanswered_question', question: input },
        ],
      );
    }

    return withAnalytics(
      {
        session: {
          ...current,
          audience: service.audience,
          lastServiceId: service.id,
          state: 'viewing_service',
        },
        replies: [serviceGuideReply(service)],
      },
      [
        {
          name: 'chatbot_service_answered',
          serviceId: service.id,
          serviceName: service.service_name,
          matchType: 'payload',
        },
      ],
    );
  }

  if (input.toLowerCase() === 'hello' || input.toLowerCase() === 'hi') {
    return withAnalytics({
      session: { ...current, state: 'selecting_service' },
      replies: [serviceListAllReply(services)],
    });
  }
  // previous audience selection removed: always show services list or match by free text

  const faqMatches = searchFaqs(input, faqs);
  if (faqMatches.length > 0) {
    return withAnalytics(
      {
        session: {
          ...current,
          state: 'viewing_faq',
        },
        replies: [faqReply(faqMatches[0])],
      },
      [{ name: 'chatbot_faq_answered', question: faqMatches[0].question }],
    );
  }

  const matches = searchServices(input, services);
  if (matches.length > 0) {
    const service = matches[0];
    return withAnalytics(
      {
        session: {
          ...current,
          audience: service.audience,
          lastServiceId: service.id,
          state: 'viewing_service',
        },
        replies: [serviceGuideReply(service)],
      },
      [
        {
          name: 'chatbot_service_answered',
          serviceId: service.id,
          serviceName: service.service_name,
          matchType: 'free_text',
        },
      ],
    );
  }

  return withAnalytics(
    {
      session: { ...current, state: 'handoff' },
      replies: [handoffReply()],
    },
    [
      { name: 'chatbot_handoff', reason: 'unanswered' },
      { name: 'chatbot_unanswered_question', question: input },
    ],
  );
}

module.exports = {
  createInitialSession,
  handleUserMessage,
  serviceGuideReply,
  serviceListReply,
};
