const {
  findServiceById,
  getServicesByAudience,
  loadServices,
  searchServices,
  tokenize,
} = require('./serviceRepository');

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

function audienceReply() {
  return {
    text: [
      'Hello! I can help you find ICO services from the Citizen\'s Charter.',
      '',
      'Are you an SLSU internal unit/office or an external partner?',
    ].join('\n'),
    quickReplies: [
      quickReply('SLSU internal unit/office', 'AUDIENCE_INTERNAL'),
      quickReply('External partner', 'AUDIENCE_EXTERNAL'),
    ],
  };
}

function servicePayload(service) {
  return `SERVICE_${service.id}`;
}

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
    quickReplies: matchingServices.map((service) => quickReply(serviceQuickReplyTitle(service), servicePayload(service))),
  };
}

function serviceListAllReply(services = loadServices()) {
  const lines = services.map((service, index) => `${index + 1}. ${service.service_name}`);

  return {
    text: [
      'Here are the ICO services:',
      '',
      ...lines,
      '',
      'Please choose a service.',
    ].join('\n'),
    quickReplies: services.map((service) => quickReply(serviceQuickReplyTitle(service), servicePayload(service))),
  };
}

function listItems(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

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
  return [
    faq.question,
    faq.answer,
    ...(Array.isArray(faq.keywords) ? faq.keywords : []),
  ].join(' ');
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
    text: [
      faq.question,
      '',
      faq.answer,
    ].join('\n'),
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
      'I can only confirm details listed in the ICO Citizen\'s Charter.',
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

function isInternalSelection(message) {
  const value = message.toLowerCase();
  return message === 'AUDIENCE_INTERNAL' || value.includes('internal') || value.includes('slsu unit');
}

function isExternalSelection(message) {
  const value = message.toLowerCase();
  return message === 'AUDIENCE_EXTERNAL' || value.includes('external') || value.includes('partner');
}

function cloneSession(session) {
  return {
    ...createInitialSession(),
    ...session,
  };
}

function handleUserMessage(session, message, services = loadServices(), faqs = []) {
  const current = cloneSession(session);
  const input = normalizeMessage(message);

  if (!input || input === 'BACK_TO_START') {
    return {
      session: { ...createInitialSession(), state: 'selecting_service' },
      replies: [serviceListAllReply(services)],
    };
  }

  if (input === 'HANDOFF') {
    return {
      session: { ...current, state: 'handoff' },
      replies: [handoffReply()],
    };
  }

  if (input === 'BACK_TO_SERVICES' && current.audience) {
    return {
      session: { ...current, state: 'selecting_service' },
      replies: [serviceListAllReply(services)],
    };
  }

  if (input.startsWith('SERVICE_')) {
    const serviceId = input.slice('SERVICE_'.length);
    const service = findServiceById(serviceId, services);
    if (!service) {
      return {
        session: { ...current, state: 'handoff' },
        replies: [handoffReply()],
      };
    }

    return {
      session: {
        ...current,
        audience: service.audience,
        lastServiceId: service.id,
        state: 'viewing_service',
      },
      replies: [serviceGuideReply(service)],
    };
  }

  if (input.toLowerCase() === 'hello' || input.toLowerCase() === 'hi') {
    return {
      session: { ...current, state: 'selecting_service' },
      replies: [serviceListAllReply(services)],
    };
  }
  // previous audience selection removed: always show services list or match by free text

  const faqMatches = searchFaqs(input, faqs);
  if (faqMatches.length > 0) {
    return {
      session: {
        ...current,
        state: 'viewing_faq',
      },
      replies: [faqReply(faqMatches[0])],
    };
  }

  const matches = searchServices(input, services);
  if (matches.length > 0) {
    const service = matches[0];
    return {
      session: {
        ...current,
        audience: service.audience,
        lastServiceId: service.id,
        state: 'viewing_service',
      },
      replies: [serviceGuideReply(service)],
    };
  }

  return {
    session: { ...current, state: 'handoff' },
    replies: [handoffReply()],
  };
}

module.exports = {
  createInitialSession,
  handleUserMessage,
  serviceGuideReply,
  serviceListReply,
};
