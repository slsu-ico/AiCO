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

const FIELD_LIMITS = {
  full_name: 160,
  email: 254,
  requested_office_name: 160,
  position: 160,
  reason: 2000,
  remarks: 2000,
  title: 240,
  body: 10000,
  requirements: 5000,
  procedure: 5000,
  fees: 1000,
  processing_time: 1000,
  service_name: 240,
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
  requirements: 'Requirements',
  procedure: 'Procedure',
  fees: 'Fees',
  processing_time: 'Processing time',
  service_name: 'Service name',
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
  VALID_ATTACHMENT_LINKED_TYPES,
  VALID_CONTENT_TYPES,
  VALID_ROLES,
};
