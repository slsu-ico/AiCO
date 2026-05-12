const {
  findServiceById,
  getServicesByAudience,
  loadServices,
  searchServices,
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
    quickReplies: matchingServices.map((service) => quickReply(service.service_name, servicePayload(service))),
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

function handoffReply() {
  return {
    text: [
      'I can only confirm details listed in the ICO Citizen\'s Charter.',
      '',
      'For requests that need staff judgment, exceptions, approvals, or information outside the charter, please contact ICO through the SLSU website or the ICO Facebook page.',
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

function handleUserMessage(session, message, services = loadServices()) {
  const current = cloneSession(session);
  const input = normalizeMessage(message);

  if (!input || input === 'BACK_TO_START') {
    return {
      session: { ...createInitialSession(), state: 'selecting_audience' },
      replies: [audienceReply()],
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
      replies: [serviceListReply(current.audience, services)],
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
      session: { ...current, state: 'selecting_audience' },
      replies: [audienceReply()],
    };
  }

  if (isInternalSelection(input)) {
    return {
      session: { ...current, audience: 'internal', state: 'selecting_service' },
      replies: [serviceListReply('internal', services)],
    };
  }

  if (isExternalSelection(input)) {
    return {
      session: { ...current, audience: 'external', state: 'selecting_service' },
      replies: [serviceListReply('external', services)],
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
