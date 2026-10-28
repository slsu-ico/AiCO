const { FIELDS, CONTACT, validateKnowledge } = require('./knowledge');
const { classifyQuestion, resolveServiceChoice } = require('./rules');

const TITLES = {
  'external-layout-iec-materials': 'Layout (Partner)',
  'external-documentation-services': 'Docs (Partner)',
  'internal-training-speakership': 'Training/Speaker',
  'internal-layout-iec-materials': 'Layout (SLSU)',
  'internal-writing-request': 'Writing',
  'internal-posting-email-blast': 'Posting/Email',
  'internal-audiovisual-production': 'Audiovisual',
  'internal-documentation-services': 'Documentation',
  'internal-review-layout-writeup': 'Review Material',
  'internal-photo-video-assets': 'Photo/Video Assets',
};
const LABELS = {
  en: {
    description: 'About',
    who_may_avail: 'Who may avail',
    requirements: 'Requirements',
    submission_timeline: 'Submission reminders',
    fees: 'Fees',
    processing_time: 'Processing time',
    official_link: 'Official form',
  },
  fil: {
    description: 'Tungkol sa serbisyo',
    who_may_avail: 'Sino ang maaaring kumuha',
    requirements: 'Mga requirement',
    submission_timeline: 'Mga paalala',
    fees: 'Bayarin',
    processing_time: 'Oras ng proseso',
    official_link: 'Opisyal na form',
  },
};

function validateDecision(value, services) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'action,fields,serviceIds'
  ) {
    return false;
  }
  if (!['answer', 'clarify', 'out_of_scope', 'handoff'].includes(value.action)) return false;
  if (
    !Array.isArray(value.serviceIds) ||
    value.serviceIds.length > services.length ||
    new Set(value.serviceIds).size !== value.serviceIds.length ||
    value.serviceIds.some((id) => !services.some((s) => s.id === id))
  ) {
    return false;
  }
  if (
    !Array.isArray(value.fields) ||
    value.fields.length > FIELDS.length ||
    value.fields.some((f) => !FIELDS.includes(f))
  ) {
    return false;
  }
  if (value.action === 'answer') return value.serviceIds.length > 0;
  if (value.action === 'clarify') return value.serviceIds.length > 1 && value.fields.length === 0;
  return value.serviceIds.length === 0 && value.fields.length === 0;
}

function createConversation({ services, classify = classifyQuestion }) {
  validateKnowledge(services);
  const choices = (items) =>
    items.map((s) => ({
      title: (TITLES[s.id] || s.service_name).slice(0, 20),
      payload: `SERVICE_${s.id}`,
    }));
  return async function conversation(previous = {}, raw = '') {
    const message = String(raw).trim();
    const locale =
      /\b(po|paano|saan|magkano|kailangan|kumusta|kamusta|salamat|puwede|pwede)\b/i.test(message)
        ? 'fil'
        : previous.locale === 'fil'
          ? 'fil'
          : 'en';
    const session = { locale };
    if (['internal', 'external'].includes(previous.audience)) session.audience = previous.audience;
    if (services.some((s) => s.id === previous.lastServiceId)) {
      session.lastServiceId = previous.lastServiceId;
    }
    if (Array.isArray(previous.candidateIds) && previous.candidateIds.length <= services.length) {
      const ids = [...new Set(previous.candidateIds)].filter((id) =>
        services.some((s) => s.id === id),
      );
      if (ids.length) session.candidateIds = ids;
    }
    if (Array.isArray(previous.choiceIds) && previous.choiceIds.length <= services.length) {
      session.choiceIds = previous.choiceIds.filter((id) => services.some((s) => s.id === id));
    }
    const result = (text, quickReplies = choices(services)) => ({
      session,
      replies: [{ text, quickReplies }],
    });
    const menu = (prefix = '') => {
      delete session.candidateIds;
      session.choiceIds = services.map((s) => s.id);
      return result(
        [
          prefix,
          locale === 'fil'
            ? 'Ako ang SLSU ICO services assistant. Pumili ng serbisyo upang makita ang mga requirement at opisyal na form.'
            : 'I am the SLSU ICO services assistant. Choose a service for requirements and the official form.',
          ...services.map(
            (s, i) =>
              `${i + 1}. ${s.service_name} (${s.audience === 'both' ? 'SLSU/Partner' : s.audience === 'internal' ? 'SLSU' : 'Partner'})`,
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    };
    const handoff = () =>
      menu(
        locale === 'fil'
          ? `Para sa pasya, approval, exception, status, o impormasyong wala sa ICO service guide, direktang makipag-ugnayan sa ICO: ${CONTACT}. Gabay lamang ako sa mga serbisyo at opisyal na form.`
          : `For decisions, approvals, exceptions, request status, or information absent from the ICO service guide, contact ICO directly: ${CONTACT}. I provide service and official-form guidance.`,
      );
    const guide = (service, fields) => {
      delete session.candidateIds;
      delete session.choiceIds;
      session.lastServiceId = service.id;
      if (service.audience !== 'both') session.audience = service.audience;
      const selected = fields.length ? [...new Set([...fields, 'official_link'])] : FIELDS;
      const lines = selected.map(
        (field) =>
          `${LABELS[locale][field]}: ${Array.isArray(service[field]) ? '\n- ' + service[field].join('\n- ') : service[field]}`,
      );
      return result(
        [
          service.service_name,
          ...lines,
          locale === 'fil'
            ? 'Kumpletuhin ang kahilingan sa opisyal na form. Gabay lamang ang chat na ito.'
            : 'Complete your request on the official form. This chat provides guidance only.',
        ].join('\n\n'),
        [
          { title: locale === 'fil' ? 'Mga serbisyo' : 'Services', payload: 'MENU' },
          { title: 'Contact ICO', payload: 'HANDOFF' },
        ],
      );
    };
    const clarify = (items) => {
      session.candidateIds = items.map((s) => s.id);
      session.choiceIds = [...session.candidateIds];
      delete session.lastServiceId;
      return result(
        [
          locale === 'fil'
            ? 'Pumili po ng serbisyo gamit ang button o numerong nasa listahan.'
            : 'Choose a service using its button or the number in this list.',
          ...items.map(
            (s, i) =>
              `${i + 1}. ${s.service_name} (${s.audience === 'both' ? 'SLSU/Partner' : s.audience === 'internal' ? 'SLSU' : 'Partner'})`,
          ),
        ].join('\n'),
        choices(items),
      );
    };
    if (
      !message ||
      /^(hello|hi|kumusta(?: po)?|kamusta(?: po)?|menu|start|get_started|back_to_start)$/i.test(
        message,
      )
    ) {
      delete session.lastServiceId;
      delete session.audience;
      return menu();
    }
    if (message.length > 2000) {
      return menu(
        locale === 'fil'
          ? 'Paikliin po ang tanong tungkol sa ICO.'
          : 'Please shorten your question about ICO services.',
      );
    }
    if (
      message === 'HANDOFF' ||
      /\b(approve my|approve this|request status|status of my|track my|guarantee|make an exception|late request|urgent request)\b/i.test(
        message,
      )
    ) {
      return handoff();
    }
    if (
      /\b(ignore|override|disregard)\b.{0,50}\b(instruction|rule|prompt)|\b(system prompt|reveal.{0,20}(secret|token|key))\b/i.test(
        message,
      )
    ) {
      return menu(
        locale === 'fil'
          ? 'Para lamang ako sa mga serbisyo ng ICO.'
          : 'I can only help with SLSU ICO services.',
      );
    }
    if (message.startsWith('SERVICE_')) {
      const service = services.find((s) => s.id === message.slice(8));
      return service ? guide(service, []) : menu();
    }
    const selectedChoice = resolveServiceChoice(message, session, services);
    if (selectedChoice) return guide(selectedChoice, []);
    const explicitInternal = /\binternal\b/i.test(message);
    const explicitExternal = /\bexternal\b/i.test(message);
    if (explicitInternal !== explicitExternal) {
      const audience = explicitInternal ? 'internal' : 'external';
      const previousService = services.find((s) => s.id === session.lastServiceId);
      if (
        previousService &&
        previousService.audience !== 'both' &&
        previousService.audience !== audience
      ) {
        delete session.lastServiceId;
      }
      session.audience = audience;
    }
    const audienceReply =
      /^(?:slsu|internal|internal office|sl?su office|university office)$/i.test(message)
        ? 'internal'
        : /^(?:external|external partner|partner)$/i.test(message)
          ? 'external'
          : null;
    if (audienceReply && session.candidateIds?.length) {
      const selected = services.filter(
        (s) =>
          session.candidateIds.includes(s.id) &&
          (s.audience === audienceReply || s.audience === 'both'),
      );
      if (selected.length === 1) {
        session.audience = audienceReply;
        return guide(selected[0], []);
      }
      if (selected.length > 1) {
        session.audience = audienceReply;
        return clarify(selected);
      }
    }
    if (
      /^(where (?:is|can i (?:find|get)) (?:the )?(?:official )?(?:request )?(?:form|link)\??|(?:saan(?: po)? (?:ang )?(?:form|link))\??|(?:form|form link|official form|link))$/i.test(
        message,
      )
    ) {
      const service = services.find((s) => s.id === session.lastServiceId);
      return service ? guide(service, ['official_link']) : menu();
    }
    if (!classify) return menu();
    let decision;
    try {
      decision = await classify({ message, session, services });
    } catch {
      return menu();
    }
    if (!validateDecision(decision, services)) return menu();
    if (decision.action === 'handoff') return handoff();
    if (decision.action === 'out_of_scope') {
      return menu(
        locale === 'fil'
          ? 'Para lamang ako sa mga serbisyo ng ICO.'
          : 'I can only help with SLSU ICO services.',
      );
    }
    let candidates = services.filter((s) => decision.serviceIds.includes(s.id));
    // Shared service names exist for both audiences; do not guess eligibility.
    if (decision.action === 'answer' && !session.audience) {
      candidates = services.filter((s) =>
        candidates.some((c) => c.service_name === s.service_name),
      );
    }
    if (
      session.audience &&
      candidates.some((s) => s.audience === session.audience || s.audience === 'both')
    ) {
      candidates = candidates.filter(
        (s) => s.audience === session.audience || s.audience === 'both',
      );
    }
    if (decision.action === 'answer' && candidates.length === 1) {
      return guide(candidates[0], decision.fields);
    }
    return clarify(candidates);
  };
}

module.exports = { createConversation, validateDecision };
