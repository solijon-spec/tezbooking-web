/*
 * TezBooking — operator live-search API.
 *
 * A request is validated and cached, then dispatched to the configured SAMO adapters
 * under shared global and per-operator concurrency limits. A failed source never
 * prevents partial results from the remaining sources.
 *
 * Paket tarkibi:
 *   Uchish sanasi va soati — tur qatorining o'zidan (samo.js → dep, depDate). GDS paketlar — gds: true.
 *   Mehmonxonalar: operatorda "faqat mehmonxona" qidiruvi yo'q yoki bo'sh bo'lsa, mehmonxona tur paket ichidan olinadi
 *                  (fromTour: true). Chipta narxi ma'lum bo'lsa — narx = paket − chipta; aks holda narx — paket narxi
 *                  (withFlight: true, saytda "narx aviareys bilan" deb yoziladi — o'ylab topilgan bo'linma yo'q).
 *   LIVE_TOUR_TICKETS=1 (sukut bo'yicha o'chiq) — operatorning alohida aviachiptalar sahifasidan mos reysni olib, chipta narxini
 *                  biriktirishga urinadi. 2026-11-24 dagi sinovda operatorlarning ochiq chipta sahifalari charter reys qaytarmadi,
 *                  paket tarkibi (samo_action=CONTENT) ham narxni bo'lib bermaydi — shu sabab sukut bo'yicha o'chiq
 *                  (operatorlarga ortiqcha so'rov yubormaslik uchun).
 */
'use strict';

const samo = require('./samo');
const { hasCredentials } = require('./credentials');
const pegas = require('./pegas');
const asialuxe = require('./asialuxe');
const { createConcurrencyLimiter, createRateLimiter } = require('./limits');
const { parseLiveQuery } = require('./validation');

// Ulagichlar: SAMO (sukut), Pegas va Asialuxe (faqat agentlik logini bilan)
const ADAPTERS = { samo, pegas, asialuxe };
const adapterOf = (op) => ADAPTERS[op && op.adapter] || samo;
const unsupported = async () => ({ offers: [], note: 'no_page' });
const DEFAULT_SEARCHES = {
  tours: (op, q) => adapterOf(op).search(op, q),
  hotels: (op, q) => (adapterOf(op).searchHotels || unsupported)(op, q),
  flights: (op, q) => (adapterOf(op).searchFlights || unsupported)(op, q)
};

const OPERATORS = [
  { id: 'prestige', search: 'https://online.uz-prestige.com/search_tour' },
  { id: 'kazunion', search: 'https://online.kazunion.com/search_tour' },
  { id: 'selfie', search: 'https://b2b.selfietravel.kz/search_tour' },
  { id: 'savtour', search: 'https://online.savtour.az/search_tour' },
  { id: 'vietratour', search: 'https://b2b.vietratour.com/search_tour' },
  { id: 'fstravel', search: 'https://b2b.fstravel.asia/search_tour' },
  { id: 'flykhiva', search: 'https://b2b.flykhiva.travel/search_tour' },
  { id: 'malva', search: 'https://malvatouroperator.uz/search_tour' },
  { id: 'crystalbay', search: 'https://booking.crystalbay.com/search_tour' },
  { id: 'easybooking', search: 'https://tours.easybooking.uz/search_tour' },
  { id: 'kompas', search: 'https://online.uz.kompastour.com/search_tour' },
  { id: 'centrum', search: 'https://online.centrum-holidays.com/search_tour' },
  // anex: 2026-11 dan SAMO emas (yangi Next.js sayt, search_tour 404) — API kaliti bilan ulanadi
  { id: 'aqua', search: 'https://agency.aqua-travelgroup.com/search_tour' },
  // loginOnly: ochiq qidiruvi yo'q, faqat agentlik logini bilan (.env: OPERATOR_PEGAS_*, OPERATOR_ASIALUXE_*).
  // Login bo'lsa — sayt, Telegram bot va agentlar qidiruvida; bo'lmasa — hech qayerga ulanmaydi.
  { id: 'pegas', search: 'https://uz.pegast.asia/PackageSearch', adapter: 'pegas', loginOnly: true },
  { id: 'asialuxe', search: 'https://b2b.asialuxe.uz/', adapter: 'asialuxe', loginOnly: true }
];
// Sayt/bot qidiruvi bitta operatorni ko'pi bilan shuncha kutadi (Asialuxe sekin); qolganlar natijasi baribir qaytadi
const SITE_WAIT_MS = Number(process.env.LIVE_SITE_WAIT_MS) || 50000;
// Paketlar operator saytlarida o'zgarib turadi (narx, joy, yangi paketlar): faol qidiruvlar har LIVE_REFRESH_MS da
// (sukut bo'yicha 5 daqiqa) fon rejimida operatorlardan qayta tortiladi. Faol — oxirgi LIVE_ACTIVE_MS ichida sayt, bot
// yoki agent so'ragan. Yangi natija kelguncha eskisi beriladi; 0 — fon yangilash o'chiq.
const REFRESH_MS = (() => { const v = Number(process.env.LIVE_REFRESH_MS); return Number.isFinite(v) && v >= 0 ? (v && Math.max(60000, v)) : 5 * 60000; })();
const ACTIVE_MS = Math.max(60000, Number(process.env.LIVE_ACTIVE_MS) || 30 * 60000);
const MAX_REFRESH = 30;                       // bir aylanishda ko'pi bilan shuncha qidiruv yangilanadi (operatorlarga yuklama)
const REFRESH_PARALLEL = 2;                   // fon yangilashda bir vaqtda nechta qidiruv
const CACHE_MS_NO_REFRESH = 10 * 60000;
// Bitta operatordan bitta so'rovda ko'pi bilan shuncha taklif. SAMO: tanlangan kun 6 × ~100 + qo'shni kunlar ~100,
// FS Travel sahifasi 1000; Pegas 500. Oldin 600 edi: FlyKhiva Turkiyasida tanlangan kunning bir qismi kesilib ketardi.
const PER_OP = Math.max(100, Math.min(5000, Number(process.env.LIVE_PER_OPERATOR) || 2000));
const MAX_CACHE = 300;
const ROUTES = { '/api/live/tours': 'tours', '/api/live/hotels': 'hotels', '/api/live/flights': 'flights' };

function envInteger(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(name + ' must be an integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be between ' + min + ' and ' + max);
  }
  return value;
}

function configFromEnv(env = process.env) {
  return {
    globalConcurrency: envInteger(env, 'LIVE_GLOBAL_CONCURRENCY', 12, 1, 100),
    operatorConcurrency: envInteger(env, 'LIVE_OPERATOR_CONCURRENCY', 2, 1, 20),
    // Har bir tur qidiruvi operator boshiga 2 ta vazifa (tur + chipta) — navbat shunga mos kattaroq
    maxQueue: envInteger(env, 'LIVE_MAX_QUEUE', 200, 0, 10000),
    perClientRate: envInteger(env, 'LIVE_RATE_PER_MIN', 20, 1, 10000),
    globalRate: envInteger(env, 'LIVE_GLOBAL_RATE_PER_MIN', 300, 1, 100000),
    timeoutMs: envInteger(env, 'LIVE_TIMEOUT_MS', 40000, 1000, 120000),
    tourTickets: (env.LIVE_TOUR_TICKETS || '0').trim() === '1'
  };
}

function safeFailure(error) {
  if (error && (error.code === 'LIVE_QUEUE_FULL')) return { status: 'busy', error: 'busy' };
  if (error && (error.name === 'AbortError' || error.code === 'ETIMEDOUT')) return { status: 'error', error: 'timeout' };
  if (error && /^LIVE_UNSAFE_/.test(error.code || '')) return { status: 'error', error: 'source_blocked' };
  if (error && /^LIVE_AUTH_/.test(error.code || '')) return { status: 'error', error: 'auth_failed' };
  return { status: 'error', error: 'upstream_unavailable' };
}

function createLive({
  sendJson,
  clientIp = req => req.socket && req.socket.remoteAddress || 'unknown',
  operators = OPERATORS,
  searches = DEFAULT_SEARCHES,
  // operator kabinetiga kirish holati (parolsiz) — faqat ichki (agent ishchilari)
  authStatus = (id) => adapterOf(operators.find(op => op.id === id)).authStatus(id),
  now = Date.now,
  config,
  siteWaitMs = SITE_WAIT_MS,
  env = process.env,
  refreshMs = REFRESH_MS,
  activeMs = ACTIVE_MS
}) {
  // Sayt va Telegram bot: login talab qiladigan operator faqat login berilgan bo'lsa
  const publicOperators = operators.filter(op => !op.loginOnly || hasCredentials(op.id, env));
  // Natija shuncha vaqt yangi hisoblanadi: fon yangilash yoqiq bo'lsa — uning davri (5 daqiqa), aks holda 10 daqiqa
  const CACHE_MS = refreshMs ? Math.max(refreshMs, 60000) : CACHE_MS_NO_REFRESH;
  const settings = Object.assign(configFromEnv(), config || {});
  const cache = new Map();
  const health = {};
  const limiter = createConcurrencyLimiter({
    globalLimit: settings.globalConcurrency,
    perKeyLimit: settings.operatorConcurrency,
    maxQueue: settings.maxQueue
  });
  const rateLimiter = createRateLimiter({
    perClientLimit: settings.perClientRate,
    globalLimit: settings.globalRate,
    windowMs: 60000,
    maxClients: 10000,
    now
  });

  const ticketsOn = settings.tourTickets !== false && typeof searches.flights === 'function';
  const addDaysIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  // Operatorning shu yo'nalish va tunlarga mos borish-qaytish chiptalari (xato bo'lsa — bo'sh ro'yxat, tur natijasi buzilmaydi)
  async function ticketsFor(operator, query, from) {
    if (!ticketsOn) return [];
    try {
      const fq = {
        to: query.country, from: from || query.from || 'tas', date: query.date, ret: addDaysIso(query.date, query.nights),
        adults: query.adults, childAges: (query.childAges || []).slice(0, 3), cabin: 'eco', window: query.window || 0
      };
      const r = await limiter.run(operator.id, () => searches.flights(operator, fq));
      return (r && r.offers) || [];
    } catch (error) { return []; }
  }
  // Har bir tur taklifiga: kirish kuni va tunlarga mos eng arzon chipta; mehmonxona ≈ paket − chipta (aqlga sig'sa)
  function withTickets(offers, tickets, nights) {
    if (!tickets.length) return offers;
    const best = {};
    tickets.forEach(t => {
      if (!t.back || t.back.date !== addDaysIso(t.date, nights) || !(t.price > 0)) return;
      if (!best[t.date] || t.price < best[t.date].price) best[t.date] = t;
    });
    return offers.map(o => {
      const t = !o.gds && best[o.checkIn];
      if (!t) return o;
      const ticket = {
        price: t.price, airline: t.airline || '', no: t.no || '', dep: t.dep, arr: t.arr, fromCode: t.fromCode || '', toCode: t.toCode || '',
        back: { no: t.back.no || '', dep: t.back.dep, arr: t.back.arr }
      };
      const hotelPrice = o.price - t.price;
      return Object.assign({}, o, { ticket }, hotelPrice >= o.price * 0.1 ? { hotelPrice } : {});
    });
  }

  async function searchOperator(kind, operator, query) {
    if (kind === 'tours') {
      const [tours, tickets] = await Promise.all([
        limiter.run(operator.id, () => searches.tours(operator, query)),
        ticketsFor(operator, query)
      ]);
      return { offers: withTickets(tours.offers, tickets, query.nights), note: tours.note, more: tours.more, next: tours.next, cityApplied: tours.cityApplied };
    }
    if (kind === 'hotels') {
      const hotels = await limiter.run(operator.id, () => searches.hotels(operator, query));
      if (hotels.offers.length || typeof searches.tours !== 'function') return hotels;
      // "Faqat mehmonxona" yo'q — mehmonxona tur paket ichidan (Toshkentdan): chipta ma'lum bo'lsa paket − chipta,
      // aks holda paket narxi "aviareys bilan" belgisi bilan (bo'linma o'ylab topilmaydi)
      // Kalit tartibi sayt tur so'rovi bilan bir xil (parseLiveQuery): Toshkentdan shu tur qidiruvi keshda yoki ketayotgan bo'lsa —
      // o'sha natija olinadi, operatorga ikkinchi marta (5–6 sahifa) so'rov yuborilmaydi
      const tq = { country: query.country, date: query.date, nights: query.nights, adults: query.adults, childAges: query.childAges, from: 'tas', window: query.window || 0 };
      const shared = cache.get('tours' + JSON.stringify(tq));
      const fromShared = shared && (shared.data ? Promise.resolve(shared.data) : shared.promise.catch(() => null)).then(d => {
        const st = d && d.operators.find(s => s.id === operator.id);
        return st && st.status !== 'error' && st.status !== 'busy' ? { offers: d.offers.filter(o => o.opId === operator.id) } : null;
      });
      const [tours, tickets] = await Promise.all([
        (fromShared || Promise.resolve(null)).then(hit => hit || limiter.run(operator.id, () => searches.tours(operator, tq))).catch(() => ({ offers: [] })),
        ticketsFor(operator, tq, 'tas')
      ]);
      const derived = withTickets(tours.offers || [], tickets, query.nights).map(o => {
        const base = { packagePrice: o.price, fromTour: true, seats: 'ok', ticket: undefined, hotelPrice: undefined, dep: undefined, depDate: undefined };
        return o.hotelPrice > 0
          ? Object.assign({}, o, base, { price: Math.round(o.hotelPrice) })
          : Object.assign({}, o, base, { withFlight: true });
      });
      return { offers: derived, note: derived.length ? '' : hotels.note };
    }
    return limiter.run(operator.id, () => searches[kind](operator, query));
  }

  // Bitta operator: natija yoki xavfsiz xato holati (istisno otilmaydi)
  async function runOperator(kind, operator, query) {
    const started = now();
    let result;
    try {
      const response = await searchOperator(kind, operator, query);
      const offers = response.offers.filter(offer => offer.avail !== 'stop')
        .sort((a, b) => a.price - b.price).slice(0, PER_OP);
      result = {
        id: operator.id,
        status: offers.length ? 'ok' : (response.note || 'empty'),
        count: offers.length,
        ms: now() - started,
        offers
      };
      // Operatorda shu kun bo'yicha yana paketlar bor (narx bo'yicha keyingi sahifalar): sayt "Operatordan yana yuklash"
      if (response.more && response.next > 1) Object.assign(result, { more: true, next: response.next });
      // Operator shaharni o'zi filtrladi (SAMO TOWNS, Pegas hudud, Asialuxe shahar) — agent nom bo'yicha qayta saralamaydi
      if (response.cityApplied) result.cityApplied = true;
    } catch (error) {
      const failure = safeFailure(error);
      result = { id: operator.id, ...failure, count: 0, ms: now() - started, offers: [] };
    }
    health[result.id] = { status: result.status, count: result.count, at: now() };
    return result;
  }

  async function searchAll(kind, query) {
    // Sekin operator butun javobni ushlab turmasin: siteWaitMs dan keyin u "timeout" deb belgilanadi
    const capped = (operator) => {
      let timer;
      const late = new Promise(resolve => { timer = setTimeout(() => resolve({ id: operator.id, status: 'error', error: 'timeout', count: 0, ms: siteWaitMs, offers: [] }), siteWaitMs); });
      return Promise.race([runOperator(kind, operator, query), late]).finally(() => clearTimeout(timer));
    };
    // query.op — faqat shu operator (sayt: "Operatordan yana yuklash", query.page dan boshlab)
    const list = query.op ? publicOperators.filter(op => op.id === query.op) : publicOperators;
    const results = await Promise.all(list.map(capped));
    return {
      offers: [].concat(...results.map(result => result.offers)),
      operators: results.map(({ id, status, count, ms, error, more, next, cityApplied }) => ({ id, status, count, ms, error, more, next, cityApplied })),
      at: now()
    };
  }

  function rateLimited(req, res) {
    const retryAfter = rateLimiter.check(String(clientIp(req) || 'unknown'));
    if (!retryAfter) return false;
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, 429, { error: 'rate_limited', retryAfter });
    return true;
  }

  async function handle(req, res, pathname, url) {
    const isStatus = pathname === '/api/live/status';
    const kind = ROUTES[pathname];
    if (!isStatus && !kind) return sendJson(res, 404, { error: 'not_found' });
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }
    if (rateLimited(req, res)) return;

    if (isStatus) {
      return sendJson(res, 200, {
        kinds: Object.keys(searches),
        operators: publicOperators.map(operator => Object.assign({ id: operator.id }, health[operator.id] || {}))
      });
    }

    const query = parseLiveQuery(kind, url, { countries: samo.COUNTRY_RU, now });
    if (!query) return sendJson(res, 400, { error: 'bad_request' });

    const { entry, data } = await cachedSearch(kind, query);
    // age — natija operatorlardan necha ms oldin olingan (brauzer soati server soatidan farq qilsa ham to'g'ri hisoblash uchun)
    return sendJson(res, 200, Object.assign({ cached: !!entry.fromCache && now() - data.at > 1000, age: Math.max(0, now() - data.at) }, data));
  }

  // Kesh orqali qidiruv (sayt va Telegram bot uchun umumiy: bir xil so'rov operatorlarga ikki marta yuborilmaydi)
  async function cachedSearch(kind, query) {
    const key = kind + JSON.stringify(query);
    let entry = cache.get(key);
    // Fon yangilanishi ketayotgan bo'lsa — eski natija beriladi (yangisi bir necha soniyada keladi)
    if (entry && now() - entry.at > CACHE_MS && !entry.refreshing) {
      cache.delete(key);
      entry = null;
    }
    if (entry) entry.fromCache = !!entry.data;
    if (!entry) {
      entry = { at: now(), kind, query, promise: searchAll(kind, query) };
      cache.set(key, entry);
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      entry.promise.then(data => {
        entry.data = data;
        entry.at = now();
      }, () => cache.delete(key));
    }
    entry.usedAt = now();
    const data = entry.data || await entry.promise;
    return { entry, data };
  }

  // Yangi natija eskisining o'rniga. Operator bu safar xato bersa (vaqt tugadi, band) — uning oldingi paketlari qoladi
  // (bitta sekin javob tufayli ustun bo'shab qolmasin); boshqa holatlar (bo'sh, sotuv yopildi) — yangisi.
  function mergeFresh(old, fresh) {
    if (!old) return fresh;
    const failed = (s) => s && (s.status === 'error' || s.status === 'busy');
    const keep = new Set(fresh.operators.filter(s => failed(s)).map(s => s.id)
      .filter(id => { const o = old.operators.find(x => x.id === id); return o && !failed(o) && o.count > 0; }));
    if (!keep.size) return fresh;
    return Object.assign({}, fresh, {
      offers: fresh.offers.concat(old.offers.filter(o => keep.has(o.opId))),
      operators: fresh.operators.map(s => keep.has(s.id) ? Object.assign({}, old.operators.find(x => x.id === s.id), { stale: true }) : s)
    });
  }

  // Fon yangilash: faol qidiruvlar (sayt, bot, agentlar) har refreshMs da operatorlardan qayta tortiladi
  function refreshDue() {
    if (!refreshMs) return [];
    const t = now();
    const due = [];
    const failedOf = (entry) => entry.data.operators.filter(s => s.status === 'error' || s.status === 'busy').map(s => s.id);
    cache.forEach(entry => {
      if (!entry.data || entry.refreshing || entry.query.op) return;            // "yana yuklash" sahifalari yangilanmaydi
      if (t - (entry.usedAt || entry.at) > activeMs) return;                   // hech kim ko'rmayapti
      if (t - entry.at >= refreshMs - 30000) { due.push({ entry, at: entry.at }); return; }
      // Biror operator vaqtga sig'magan / band bo'lgan — 5 daqiqa kutilmaydi: 1 daqiqadan keyin faqat o'sha operator(lar) qayta so'raladi
      const failed = failedOf(entry);
      if (failed.length && t - (entry.retryAt || entry.at) >= 60000) due.push({ entry, at: entry.retryAt || entry.at, only: failed });
    });
    oneCache.forEach(entry => {
      if (!entry.result || entry.refreshing) return;
      if (t - (entry.usedAt || entry.at) > activeMs) return;
      if (t - entry.at >= refreshMs - 30000) due.push({ entry, at: entry.at });
    });
    return due.sort((a, b) => a.at - b.at).slice(0, MAX_REFRESH);
  }
  // Navbat bilan, bir vaqtda REFRESH_PARALLEL ta qidiruv: aks holda 30 qidiruv × 15 operator navbatni (LIVE_MAX_QUEUE) to'ldirib,
  // haqiqiy foydalanuvchi qidiruvi "band" (busy) bo'lib qolardi. Oldingi aylanish tugamagan bo'lsa — yangisi boshlanmaydi.
  let ticking = false;
  async function refreshTick() {
    if (ticking) return 0;
    ticking = true;
    try {
      const due = refreshDue();
      due.forEach(job => { job.entry.refreshing = true; });
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(REFRESH_PARALLEL, due.length) }, async () => {
        while (i < due.length) await refreshOne(due[i++]);
      }));
      return due.length;
    } finally { ticking = false; }
  }
  async function refreshOne({ entry, only }) {
    try {
      if (entry.operator) {
        const result = await runOperator(entry.kind, entry.operator, entry.query);
        if (result.status !== 'error' && result.status !== 'busy') { entry.result = result; entry.promise = Promise.resolve(result); }
        entry.at = now();
      } else if (only) {
        // Faqat xato bergan operatorlar: natijasi eski ma'lumot ichida almashtiriladi, umumiy yangilash vaqti (at) o'zgarmaydi
        const ops = publicOperators.filter(op => only.includes(op.id));
        const results = await Promise.all(ops.map(op => runOperator(entry.kind, op, entry.query)));
        const byId = new Map(results.map(r => [r.id, r]));
        const pick = ({ id, status, count, ms, error, more, next, cityApplied }) => ({ id, status, count, ms, error, more, next, cityApplied });
        entry.data = Object.assign({}, entry.data, {
          offers: entry.data.offers.filter(o => !byId.has(o.opId)).concat(...results.map(r => r.offers)),
          operators: entry.data.operators.map(s => (byId.has(s.id) ? pick(byId.get(s.id)) : s))
        });
        entry.promise = Promise.resolve(entry.data);
        entry.retryAt = now();
      } else {
        const fresh = await searchAll(entry.kind, entry.query);
        entry.data = mergeFresh(entry.data, fresh);
        entry.promise = Promise.resolve(entry.data);
        entry.at = now();
        entry.retryAt = 0;
      }
    } catch (error) { /* keyingi aylanishda qayta urinadi */ } finally {
      entry.refreshing = false;
    }
  }
  let refreshTimer = null;
  if (refreshMs) {
    refreshTimer = setInterval(() => { refreshTick().catch(() => {}); }, Math.min(60000, Math.max(10000, Math.round(refreshMs / 5))));
    if (refreshTimer.unref) refreshTimer.unref();
  }

  function queryOf(kind, params) {
    if (!ROUTES['/api/live/' + kind]) throw new Error('bad kind');
    const url = new URL('http://local/api/live/' + kind + '?' + new URLSearchParams(params));
    const query = parseLiveQuery(kind, url, { countries: samo.COUNTRY_RU, now });
    if (!query) throw new Error('bad query');
    return query;
  }

  // Server ichidan (Telegram bot): so'rov tekshiriladi xuddi saytdagidek, natija keshdan
  async function search(kind, params) {
    return (await cachedSearch(kind, queryOf(kind, params))).data;
  }

  // Bitta operator (agent ishchilari uchun). Sayt yoki bot xuddi shu so'rovni yaqinda qilgan bo'lsa — umumiy keshdan;
  // aks holda faqat shu operatorga so'rov (o'z keshi bilan). Xato natija keshlanmaydi — qayta urinish yangidan so'raydi.
  const oneCache = new Map();
  async function searchOne(kind, operatorId, params) {
    const operator = operators.find(op => op.id === operatorId);
    if (!operator) throw new Error('unknown operator');
    const query = queryOf(kind, params);
    const key = kind + JSON.stringify(query);
    const shared = cache.get(key);
    if (shared && shared.data && (now() - shared.at <= CACHE_MS || shared.refreshing)) {
      const status = shared.data.operators.find(op => op.id === operatorId);
      if (status && status.status !== 'error' && status.status !== 'busy') {
        shared.usedAt = now();
        return Object.assign({}, status, { offers: shared.data.offers.filter(o => o.opId === operatorId), cached: true, at: shared.at });
      }
    }
    const oneKey = key + '|' + operatorId;
    let entry = oneCache.get(oneKey);
    if (entry && now() - entry.at > CACHE_MS && !entry.refreshing) { oneCache.delete(oneKey); entry = null; }
    const hit = !!(entry && entry.result);
    if (!entry) {
      entry = { at: now(), kind, operator, query, promise: runOperator(kind, operator, query) };
      oneCache.set(oneKey, entry);
      if (oneCache.size > MAX_CACHE) oneCache.delete(oneCache.keys().next().value);
      entry.promise.then(result => {
        if (result.status === 'error' || result.status === 'busy') oneCache.delete(oneKey);
        else { entry.result = result; entry.at = now(); }
      });
    }
    entry.usedAt = now();
    const result = await entry.promise;
    return Object.assign({}, result, { cached: hit, at: entry.at });
  }

  return {
    handle, search, searchOne, authStatus, OPERATORS: operators, stats: () => limiter.stats(),
    refreshTick, refreshMs,
    stop: () => { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }
  };
}

module.exports = { createLive, configFromEnv, parseLiveQuery, OPERATORS };
