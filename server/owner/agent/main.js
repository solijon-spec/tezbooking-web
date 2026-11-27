'use strict';

const { validateSearchParameters } = require('../service');
const { parseNaturalLanguage, countryCode } = require('./parser');
const { FROM_IDS } = require('../../live/validation');

const QUESTIONS = {
  destination: 'Which destination city or resort should I search?',
  country: 'Which supported destination country should I use?',
  date: 'What is the departure date? Please use YYYY-MM-DD.',
  adults: 'How many adults are travelling?',
  nights: 'How many nights should the trip last?',
  childrenAges: 'What are the ages of each child?',
  departureAirport: 'Which departure city should I use (Tashkent, Samarkand, Bukhara, Urgench, Namangan, Fergana, Andijan, Termez, Navoi, Karshi, Nukus or Dushanbe)?',
  budget: 'What budget and currency should I use?',
  currency: 'Which currency should I use for the budget?',
  mealPlan: 'Which meal plan should I search for (RO, BB, HB, FB, AI, or UAI)?',
  hotelStars: 'What hotel star rating should I use (1 to 5)?',
  hotelName: 'Which hotel should I search for (name up to 80 characters)?'
};

function createMainAgent({ service, workers, scheduler, llmParser, now = Date.now }) {
  function missingFields(parameters, suggested = []) {
    const missing = new Set(suggested);
    if (typeof parameters.destination !== 'string' || !parameters.destination.trim() || parameters.destination.length > 120) missing.add('destination');
    const country = countryCode(parameters.country);
    if (!country) missing.add('country');
    if (typeof parameters.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parameters.date)
      || parameters.date < new Date(now()).toISOString().slice(0, 10)) missing.add('date');
    if (!Number.isInteger(parameters.adults) || parameters.adults < 1 || parameters.adults > 8) missing.add('adults');
    if (!Number.isInteger(parameters.nights) || parameters.nights < 1 || parameters.nights > 30) missing.add('nights');
    if (!Array.isArray(parameters.childrenAges) || parameters.childrenAges.length > 4
      || parameters.childrenAges.some(age => !Number.isInteger(age) || age < 0 || age > 17)) missing.add('childrenAges');
    if (parameters.budget !== undefined && parameters.budget !== null
      && (!Number.isFinite(parameters.budget) || parameters.budget <= 0 || parameters.budget > 100000000)) missing.add('budget');
    if (parameters.currency !== undefined && !['USD', 'EUR', 'UZS'].includes(String(parameters.currency).toUpperCase())) missing.add('currency');
    if (parameters.mealPlan != null && !['RO', 'BB', 'HB', 'FB', 'AI', 'UAI'].includes(String(parameters.mealPlan).toUpperCase())) missing.add('mealPlan');
    if (parameters.departureAirport != null && !FROM_IDS.includes(parameters.departureAirport)) missing.add('departureAirport');
    if (parameters.hotelStars != null && (!Number.isInteger(parameters.hotelStars) || parameters.hotelStars < 1 || parameters.hotelStars > 5)) missing.add('hotelStars');
    if (parameters.hotelName != null && (typeof parameters.hotelName !== 'string' || parameters.hotelName.length > 80)) missing.add('hotelName');
    return [...missing];
  }

  function normalizeParsed(parameters) {
    const country = countryCode(parameters.country);
    const hotelName = typeof parameters.hotelName === 'string' && parameters.hotelName.trim()
      ? parameters.hotelName.replace(/\s+/g, ' ').trim() : parameters.hotelName == null || parameters.hotelName === '' ? null : parameters.hotelName;
    let destination = typeof parameters.destination === 'string' ? parameters.destination.trim() : '';
    // Mehmonxona nomi bor, kurort yo'q — davlat bo'yicha qidiriladi (joyni mehmonxona belgilaydi)
    if (!destination && country && typeof hotelName === 'string') destination = country.toUpperCase();
    const normalized = {
      destination,
      country,
      date: typeof parameters.date === 'string' ? parameters.date : '',
      adults: parameters.adults,
      nights: parameters.nights,
      childrenAges: parameters.childrenAges === null || parameters.childrenAges === undefined
        ? null : Array.isArray(parameters.childrenAges) ? parameters.childrenAges : parameters.childrenAges,
      budget: parameters.budget == null || parameters.budget === '' ? null : parameters.budget,
      currency: parameters.currency || 'USD',
      hotelStars: parameters.hotelStars == null ? null : parameters.hotelStars,
      mealPlan: parameters.mealPlan == null || parameters.mealPlan === '' ? null : String(parameters.mealPlan).toUpperCase(),
      departureAirport: parameters.departureAirport || null,
      hotelName
    };
    // Qaytish sanasi ("15-22 dekabr"): tunlar soni shundan hisoblangan, topshiriqda ham saqlanadi
    if (typeof parameters.returnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parameters.returnDate)) normalized.returnDate = parameters.returnDate;
    return normalized;
  }

  async function parse(command) {
    if (typeof command !== 'string' || !command.trim() || command.trim().length > 4000) {
      return { error: 'bad_command' };
    }
    let result;
    if (llmParser && llmParser.enabled) {
      try {
        result = { parameters: await llmParser.parse(command.trim()), mode: llmParser.provider || 'llm' };
      } catch (error) {
        return { error: error.code || 'llm_provider_error' };
      }
    } else {
      if (llmParser && llmParser.requested && llmParser.configurationError
        && llmParser.configurationError !== 'llm_key_missing') {
        return { error: llmParser.configurationError };
      }
      result = parseNaturalLanguage(command.trim());
    }
    if (!result || !result.parameters || typeof result.parameters !== 'object') return { error: 'invalid_parse' };
    const parameters = normalizeParsed(result.parameters);
    const missing = missingFields(parameters, result.missing || []);
    if (missing.length) {
      return {
        status: 'needs_clarification',
        parserMode: result.mode || 'deterministic',
        parameters,
        missing,
        questions: missing.map(field => QUESTIONS[field] || `Please clarify ${field}.`)
      };
    }
    const validated = validateSearchParameters(parameters, now);
    if (!validated) {
      const invalid = missingFields(parameters);
      return {
        status: 'needs_clarification',
        parserMode: result.mode || 'deterministic',
        parameters,
        missing: invalid.length ? invalid : ['date'],
        questions: (invalid.length ? invalid : ['date']).map(field => QUESTIONS[field] || `Please clarify ${field}.`)
      };
    }
    return { status: 'ready', parserMode: result.mode || 'deterministic', parameters: validated };
  }

  function createSearch(parameters, command, idempotencyKey) {
    const validated = validateSearchParameters(parameters, now);
    if (!validated) return { error: 'bad_search_parameters' };
    const compatible = workers.select(service.listWebsites(), validated);
    const created = service.createSearch(
      { command: typeof command === 'string' ? command : '', parameters: validated },
      compatible.map(item => item.site.id),
      idempotencyKey
    );
    if (created.error) return created;
    if (created.task && created.task.status === 'queued') scheduler.wake();
    return { ...created, selectedWorkers: compatible.length };
  }

  async function search(command, idempotencyKey) {
    const parsed = await parse(command);
    if (parsed.error || parsed.status === 'needs_clarification') return parsed;
    const created = createSearch(parsed.parameters, command.trim(), idempotencyKey);
    return created.error ? created : { ...created, status: 'task_created', parserMode: parsed.parserMode };
  }

  function status() {
    return {
      parser: llmParser && llmParser.enabled ? 'llm' : 'deterministic',
      llmEnabled: !!(llmParser && llmParser.enabled),
      llmProvider: llmParser && llmParser.enabled ? llmParser.provider : null,
      llmConfigurationError: llmParser && llmParser.configurationError || null,
      adaptersRegistered: workers.count()
    };
  }

  return { parse, search, createSearch, status };
}

module.exports = { createMainAgent, QUESTIONS };
