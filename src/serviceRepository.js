const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DATA_PATH = path.join(__dirname, '..', 'data', 'services.json');

const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'our',
  'need',
  'how',
  'what',
  'where',
  'when',
  'with',
  'from',
  'that',
  'this',
  'your',
  'their',
  'about',
  'can',
  'help',
]);

const TOKEN_SYNONYMS = new Map([
  ['article', ['write', 'writing', 'copy', 'content', 'documentation']],
  ['avp', ['audiovisual', 'video', 'production', 'multimedia']],
  ['design', ['layout', 'pubmat', 'poster', 'tarpaulin', 'brochure', 'flyer', 'graphics']],
  ['documentation', ['photo', 'video', 'coverage', 'recording', 'footage']],
  ['layout', ['design', 'pubmat', 'poster', 'tarpaulin', 'brochure', 'flyer', 'graphics']],
  ['posting', ['facebook', 'website', 'publish', 'announcement', 'email', 'blast']],
  ['report', ['article', 'write', 'writing', 'documentation', 'content']],
  ['review', ['check', 'proofread', 'edit', 'approve']],
  ['speakership', ['speaker', 'seminar', 'training', 'workshop']],
  ['write', ['article', 'report', 'writing', 'copy', 'content', 'documentation']],
  ['writing', ['article', 'report', 'write', 'copy', 'content', 'documentation']],
]);

function loadServices(dataPath = DEFAULT_DATA_PATH) {
  const raw = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(raw);
}

function getServicesByAudience(audience, services = loadServices()) {
  return services.filter((service) => service.audience === audience);
}

function findServiceById(id, services = loadServices()) {
  return services.find((service) => service.id === id) || null;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function expandTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of TOKEN_SYNONYMS.get(token) || []) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

function serviceSearchText(service) {
  return [
    service.id,
    service.service_name,
    service.description,
    service.office_or_unit,
    service.who_may_avail,
    ...service.requirements,
    ...service.submission_timeline,
  ]
    .join(' ')
    .toLowerCase();
}

function searchServices(query, services = loadServices()) {
  const tokens = expandTokens(tokenize(query));
  if (tokens.length === 0) return [];

  const scored = services
    .map((service) => {
      const haystack = serviceSearchText(service);
      const score = tokens.reduce((total, token) => {
        if (token === 'avp' && service.id.includes('audiovisual')) return total + 5;
        if (haystack.includes(token)) return total + (service.id.includes(token) ? 3 : 1);
        return total;
      }, 0);
      return { service, score };
    })
    .filter((item) => item.score >= 1)
    .sort((a, b) => b.score - a.score);

  return scored.map((item) => item.service);
}

module.exports = {
  findServiceById,
  getServicesByAudience,
  loadServices,
  searchServices,
  tokenize,
};
