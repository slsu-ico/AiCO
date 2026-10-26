// Deliberately bounded service lookup: no model, web search, or generated prose.
const CODES = {
  E1: 'external-layout-iec-materials',
  E2: 'external-documentation-services',
  S1: 'internal-training-speakership',
  S2: 'internal-layout-iec-materials',
  S3: 'internal-writing-request',
  S4: 'internal-posting-email-blast',
  S5: 'internal-audiovisual-production',
  S6: 'internal-documentation-services',
  S7: 'internal-review-layout-writeup',
  S8: 'internal-photo-video-assets',
};

const VOCABULARY = new Set(
  `
  i we you my our your me us a an the this that these those and or of to for from with in on at by
  is are am be do does can could would should please help need needs needed want wants request requests
  requesting get getting have has how what where when which who may much long it its one some all
  make create prepare provide
  slsu ico internal external unit units university office offices partner partners service services
  event events materials material iec layout layouts design designs poster posters pubmat pubmats
  tarpaulin tarpaulins brochure brochures flyer flyers certificate certificates invitation invitations
  documentation document photo photos photograph photographs photography video videos videography
  coverage cover recording raw footage audiovisual avp production multimedia highlights highlight
  storyboard script editing edit assets asset existing download access drone shots shot
  training trainings speaker speakers speakership workshop workshops seminar seminars resource person
  article articles report reports writing write written writeup news feature technical paper papers
  posting post posts publish publishing facebook website email blast dissemination announcement announcements
  review reviewing check checking proofread proofreading revision revisions
  fee fees free charge charges cost costs price prices payment pay requirements requirement documents
  checklist eligible eligibility avail allowed processing time duration turnaround minutes days
  deadline deadlines advance submission submit submitting timeline reminders steps process procedure
  form forms link links online job order purpose use description details information about
  po opo ba paano saan kailan magkano bayad ang ng mga ano kailangan kinakailangan para sa namin
  may sino puwede pwede humingi larawan litrato bidyo ilang araw minuto gaano katagal salamat
`
    .split(/\s+/)
    .filter(Boolean),
);

function normalize(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveServiceChoice(message, session, services) {
  const value = String(message).trim().toUpperCase();
  const codeId = CODES[value.replace(/\s+/g, '')];
  if (codeId) return services.find((s) => s.id === codeId) || null;
  if (!/^(?:[1-9]|10)$/.test(value)) return null;
  const items = (session.choiceIds || [])
    .map((id) => services.find((s) => s.id === id))
    .filter(Boolean);
  return items[Number(value) - 1] || null;
}

function classifyQuestion({ message, session, services }) {
  const text = normalize(message);
  const decide = (action, serviceIds = [], fields = []) => ({ action, serviceIds, fields });
  const eligibilityQuestion =
    /\b(who (?:may|can|could) (?:avail|request|get|use)|eligible|eligibility|sino (?:po )?(?:ang )?(?:puwede|pwede))\b/.test(
      text,
    );
  const formQuestion =
    /\b(form|forms|link|links)\b/.test(text) ||
    /\b(where|saan)\b.*\b(request|submit|get|find|humingi)\b/.test(text);
  if (
    (/\bwho\b/.test(text) && !eligibilityQuestion) ||
    (/\b(where|saan)\b/.test(text) && !formQuestion)
  ) {
    return decide('handoff');
  }
  if (
    /\b(approve|approved|approval|exception|urgent|asap|status|track|tracking|guarantee|availability|available tomorrow|office hours|opening hours|open|head|staff|phone|contact|human|tao)\b/.test(
      text,
    ) ||
    /\b(address|venue|schedule|date)\b/.test(text) ||
    (/\bemail\b/.test(text) && !/\bemail blast\b/.test(text))
  ) {
    return decide('handoff');
  }
  if (!text || text.split(' ').some((word) => !VOCABULARY.has(word))) return decide('out_of_scope');
  const fields = [];
  if (
    /\b(fee|fees|free|charge|charges|cost|costs|price|prices|pay|payment|magkano|bayad)\b/.test(
      text,
    )
  ) {
    fields.push('fees');
  }
  if (/\b(requirement|requirements|checklist|documents|kailangan|kinakailangan)\b/.test(text)) {
    fields.push('requirements');
  }
  if (eligibilityQuestion) fields.push('who_may_avail');
  if (
    /\b(processing|duration|turnaround|how long|gaano katagal|ilang araw|ilang minuto)\b/.test(text)
  ) {
    fields.push('processing_time');
  }
  if (/\b(deadline|deadlines|advance|timeline|when|kailan)\b/.test(text)) {
    fields.push('submission_timeline');
  }
  if (formQuestion) fields.push('official_link');
  if (/\b(steps|process|procedure)\b/.test(text)) {
    fields.push('requirements', 'submission_timeline');
  }
  const ids = new Set();
  const add = (...values) => values.forEach((id) => ids.add(id));
  const review =
    /\b(review|reviewing|check|checking|proofread|proofreading|revision|revisions)\b/.test(text);
  const assets = /\b(assets|asset|existing|download)\b/.test(text);
  const coverage =
    /\b(documentation|coverage|photography|videography|recording|raw footage)\b/.test(text);
  const avp =
    /\b(avp|audiovisual|production|multimedia|highlights|highlight|storyboard|video editing)\b/.test(
      text,
    );
  if (review) add('internal-review-layout-writeup');
  if (
    !review &&
    /\b(layout|layouts|design|designs|poster|posters|pubmat|pubmats|tarpaulin|tarpaulins|brochure|brochures|flyer|flyers|certificate|certificates|iec)\b/.test(
      text,
    )
  ) {
    add('external-layout-iec-materials', 'internal-layout-iec-materials');
  }
  if (
    !review &&
    /\b(writing|write|written|writeup|article|articles|report|reports|technical paper|technical papers)\b/.test(
      text,
    )
  ) {
    add('internal-writing-request');
  }
  if (
    /\b(training|trainings|speaker|speakers|speakership|workshop|workshops|seminar|seminars)\b/.test(
      text,
    )
  ) {
    add('internal-training-speakership');
  }
  if (
    /\b(posting|post|posts|publish|publishing|dissemination|email blast|announcement|announcements)\b/.test(
      text,
    )
  ) {
    add('internal-posting-email-blast');
  }
  if (assets) add('internal-photo-video-assets');
  if (coverage) {
    add('external-documentation-services', 'internal-documentation-services');
  }
  if (avp) add('internal-audiovisual-production');
  if (
    !assets &&
    !coverage &&
    !avp &&
    /\b(photo|photos|photograph|photographs|video|videos|larawan|litrato|bidyo|drone|shots)\b/.test(
      text,
    )
  ) {
    add(
      'external-documentation-services',
      'internal-documentation-services',
      'internal-photo-video-assets',
    );
    if (/\b(video|videos|bidyo)\b/.test(text)) add('internal-audiovisual-production');
  }
  if (!ids.size && fields.length && services.some((s) => s.id === session.lastServiceId)) {
    add(session.lastServiceId);
  }
  const matches = services.filter((s) => ids.has(s.id));
  if (!matches.length) {
    return decide(
      'clarify',
      services.map((s) => s.id),
    );
  }
  return decide(
    'answer',
    matches.map((s) => s.id),
    [...new Set(fields)],
  );
}

module.exports = { classifyQuestion, resolveServiceChoice };
