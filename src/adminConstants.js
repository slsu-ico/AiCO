const VALID_ROLES = new Set(['admin', 'office_user']);
const VALID_CONTENT_TYPES = new Set([
  'citizens_charter_service',
  'faq',
  'event',
  'project',
  'program',
  'activity',
]);
const VALID_ATTACHMENT_LINKED_TYPES = new Set(['content_version', 'account_request']);
const LIST_PAGE_SIZE = 20;
const TEMPORARY_PASSWORD_MIN_LENGTH = 12;

const FIELD_LIMITS = {
  full_name: 160,
  email: 254,
  requested_office_name: 160,
  position: 160,
  reason: 2000,
  remarks: 2000,
  title: 240,
  body: 10000,
  service_id: 120,
  description: 10000,
  office_or_unit: 240,
  classification: 160,
  transaction_type: 160,
  who_may_avail: 1000,
  requirements: 5000,
  submission_timeline: 5000,
  procedure: 5000,
  official_link: 2048,
  fees: 1000,
  processing_time: 1000,
  service_name: 240,
  css_reminder: 1000,
  question: 240,
  answer: 10000,
  keywords: 2000,
  admin_note: 2000,
  note: 2000,
  password: 256,
};

const FIELD_LABELS = {
  full_name: 'Full name',
  email: 'Email',
  requested_office_name: 'Office name',
  position: 'Position',
  reason: 'Reason',
  remarks: 'Remarks',
  title: 'Title',
  body: 'Body',
  service_id: 'Service ID',
  description: 'Description',
  office_or_unit: 'Office or unit',
  classification: 'Classification',
  transaction_type: 'Transaction type',
  who_may_avail: 'Who may avail',
  requirements: 'Requirements',
  submission_timeline: 'Submission timeline',
  procedure: 'Procedure',
  official_link: 'Official link',
  fees: 'Fees',
  processing_time: 'Processing time',
  service_name: 'Service name',
  css_reminder: 'Client Satisfaction Survey reminder',
  question: 'FAQ question',
  answer: 'FAQ answer',
  keywords: 'FAQ keywords',
  admin_note: 'Admin note',
  note: 'Review note',
  password: 'Password',
};

const CONTENT_TYPE_LABELS = {
  citizens_charter_service: "Citizen's Charter service",
  faq: 'FAQ',
  event: 'Event',
  project: 'Project',
  program: 'Program',
  activity: 'Activity',
};

module.exports = {
  CONTENT_TYPE_LABELS,
  FIELD_LABELS,
  FIELD_LIMITS,
  LIST_PAGE_SIZE,
  TEMPORARY_PASSWORD_MIN_LENGTH,
  VALID_ATTACHMENT_LINKED_TYPES,
  VALID_CONTENT_TYPES,
  VALID_ROLES,
};
