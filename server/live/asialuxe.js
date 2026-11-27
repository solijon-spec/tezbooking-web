'use strict';

/*
 * TezBooking — Asialuxe (b2b.asialuxe.uz) ulagichi: agentlik kabineti orqali tur paketlar (reys + mehmonxona).
 *
 * Asialuxe'da ochiq qidiruv yo'q — faqat agentlik logini bilan (.env: OPERATOR_ASIALUXE_LOGIN / _PASSWORD).
 * B2B saytning o'zi ishlatadigan API (api.asialuxe.app), hech qanday himoya chetlab o'tilmaydi:
 *   POST /v1/user/b2b-sign-in {phone_or_email, password}  -> Bearer token
 *   GET  /v2/location/airports?product=package  uchish shahri -> davlat -> shaharlar (location_id, aeroport kodi), 12 soat keshda
 *   GET  /v2/tour/directions                   charter yo'nalishlar (birinchi navbatda shular qidiriladi), 12 soat keshda
 *   POST /v2/tour/list                          paketlar (USD, eng arzoni birinchi); reys yuklanguncha "pending" — qayta so'raladi
 * Asialuxe dinamik paket tuzadi: aniq sana bilan qidiriladi (±kun oynasi yo'q), har shahar alohida so'rov (ko'pi bilan 2 ta).
 * Mehmonxona nomi berilsa: birinchi javobdagi mehmonxonalar ro'yxatidan (nom -> kod) kodlar olinib, filtr bilan qayta so'raladi.
 */

const { createSafeFetch } = require('./safe-http');
const { createAuth, authError } = require('./auth');
const { hotelMatcher } = require('./hotel-match');
const { mealCode } = require('./samo');
const { DESTINATIONS } = require('../../js/agent-parser.js');
const { cityMatcher } = require('../../js/cities.js');

const normName = (s) => ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
// Kurort nomi ("Istanbul", "Antalyaga", "Стамбул") -> shu shaharni taniydigan nomlar ro'yxati
function cityAliases(city) {
  const typed = normName(city);
  const known = DESTINATIONS.find(([name, , aliases]) => [name].concat(aliases).some(a => {
    const x = normName(a).trim();
    return typed.includes(' ' + x + ' ') || (x.length >= 4 && typed.includes(' ' + x));
  }));
  return [...new Set((known ? [known[0]].concat(known[2]) : [city]).map(a => normName(a).trim()).filter(a => a.length >= 3))];
}

const API = 'https://api.asialuxe.app';
const SITE = 'https://b2b.asialuxe.uz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 TezBooking/1.0';
const TIMEOUT = Math.max(Number(process.env.LIVE_SLOW_TIMEOUT_MS) || 0, 150000);
const safeFetch = createSafeFetch({ timeoutMs: TIMEOUT, maxResponseBytes: 24 * 1024 * 1024 });
const MAX_CITIES = 2;
const DAY = 86400000;
const shiftIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const minutesOf = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});
const headers = (extra) => Object.assign({ 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'ru', Origin: SITE, Referer: SITE + '/' }, extra);
const upstream = (status) => Object.assign(new Error('supplier request failed'), { code: 'LIVE_UPSTREAM_STATUS', status });

// ---------- Kirish ----------
async function logon(op, creds, signal, fetchImpl = safeFetch) {
  const r = await fetchImpl(API + '/v1/user/b2b-sign-in', {
    method: 'POST', signal, allowedOrigin: API, body: JSON.stringify({ phone_or_email: creds.login, password: creds.password }),
    headers: headers({ 'Content-Type': 'application/json' })
  });
  if (r.status >= 500) throw upstream(r.status);
  let answer = null;
  try { answer = JSON.parse(await r.text()); } catch (e) { answer = null; }
  const token = answer && answer.data && answer.data.token;
  if (!token || typeof token !== 'string') throw authError('LIVE_AUTH_FAILED');
  return token;
}

// Token uzoq yashaydi — 6 soat qayta ishlatiladi; 401 bo'lsa qayta kiriladi
const auth = createAuth({ logon, ttlMs: 6 * 3600000 });

async function call(op, method, path, body, signal, fetchImpl = safeFetch, retried = false) {
  const token = await auth.session(op, signal, { fetchImpl });
  if (!token) throw authError('LIVE_AUTH_REQUIRED');
  const r = await fetchImpl(API + path, {
    method, signal, allowedOrigin: API, body: body ? JSON.stringify(body) : undefined,
    headers: headers(Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}))
  });
  if (r.status === 401 && !retried) {
    auth.expire(op.id);
    return call(op, method, path, body, signal, fetchImpl, true);
  }
  if (r.status === 429) { await sleep(2000, signal); return call(op, method, path, body, signal, fetchImpl, retried); }
  if (r.status !== 200) throw upstream(r.status);
  try { return JSON.parse(await r.text()); } catch (e) { throw upstream(r.status); }
}

// ---------- Ma'lumotnomalar ----------
const cache = new Map();
async function cached(key, ttl, load) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.value;
  const value = await load();
  cache.set(key, { value, at: Date.now() });
  return value;
}

// Shu uchish shahridan shu davlatga qidiriladigan shaharlar: charter yo'nalishlar birinchi
async function citiesFor(op, from, country, signal, fetchImpl, city) {
  const [airports, directions] = await Promise.all([
    cached(op.id + '|airports', 12 * 3600000, async () => (await call(op, 'GET', '/v2/location/airports?product=package', null, signal, fetchImpl)).from || []),
    cached(op.id + '|directions', 12 * 3600000, async () => (await call(op, 'GET', '/v2/tour/directions', null, signal, fetchImpl)).directions || [])
  ]);
  let fromCity = null;
  airports.forEach(c => (c.cities || []).forEach(city => { if (String(city.code).toUpperCase() === from) fromCity = city; }));
  if (!fromCity) return { note: 'no_departure', cities: [] };
  const target = (fromCity.to || []).find(c => String(c.country).toUpperCase() === country);
  const all = target ? (target.cities || []).filter(c => c.location_id && /^[A-Z]{3}$/.test(String(c.code).toUpperCase())) : [];
  if (!all.length) return { note: 'no_country', cities: [] };
  const charter = directions.filter(d => String(d.depute).toUpperCase() === from && String(d.country).toUpperCase() === country)
    .map(d => all.find(c => String(c.code).toUpperCase() === String(d.arrive).toUpperCase())).filter(Boolean);
  // Shahar (kurort) tanlangan bo'lsa (sayt filtri yoki agent topshirig'i: Istanbul, Antalya, Dubay) — faqat shu shahar,
  // boshqa shahar qo'shilmaydi (TezBooking filtri bilan bir xil). Asialuxe'da bunday shahar bo'lmasa — no_city.
  if (city) {
    const match = cityMatcher(city, country.toLowerCase());
    const wanted = match ? all.filter(c => match(c.name) || match(c.code)) : [];
    return wanted.length ? { note: '', cities: wanted.slice(0, MAX_CITIES) } : { note: 'no_city', cities: [] };
  }
  const ordered = [...new Set(charter.concat(all))];
  // Butun davlat — 4 tagacha charter shahar (parallel), aks holda mavsumi yopiq birinchi shaharlar
  // (qishda Antaliya, Bodrum) Istanbul kabi ochiq yo'nalishni to'sib qo'yadi
  return { note: '', cities: ordered.slice(0, Math.max(MAX_CITIES, Math.min(4, charter.length))) };
}

// ---------- Natijalar ----------
// cityName — qidirilgan shahar (Стамбул, Дубай): Asialuxe mehmonxona joyini tuman bilan yozadi (SULTANAHMET, FATIH),
// shahar nomi bo'lmasa kurort filtri ularni tashlab yuborardi
function parseHotels(op, j, q, cityName) {
  const flights = new Map(((j.flight && j.flight.offers) || []).map(f => [f.result_id, f]));
  const out = [];
  for (const h of j.hotels || []) {
    const room = (h.rooms || [])[0];
    if (!room || (h.currency || room.currency) !== 'USD') continue;
    const price = Number(room.package_total || h.total);
    if (!(price > 0) || !h.name) continue;
    const flight = h.flight && (flights.get(h.flight.result_id) || h.flight);
    const outbound = ((flight && flight.segments) || []).filter(s => !s.is_return);
    const first = outbound[0], last = outbound[outbound.length - 1];
    out.push({
      opId: op.id, hotelKey: String(h.id), hotel: String(h.name).trim(),
      stars: Math.min(5, Math.max(0, Math.round(Number(h.content && h.content.stars) || 0))),
      city: [...new Set([cityName].concat(String(h.city || '').split(',')).map(s => String(s || '').trim()).filter(Boolean))].join(', '),
      tour: (j.direction && j.direction.name) || '', gds: !!(j.direction && j.direction.channel && j.direction.channel !== 'charter'),
      dep: first ? minutesOf(first.departure_time) : null, depDate: first ? first.departure_date || null : null,
      fromCode: first ? String(first.departure || '') : '', toCode: last ? String(last.arrival || '') : '',
      checkIn: q.date, nights: Number(h.nights || room.nights) || q.nights,
      meal: mealCode(room.board || (room.boards || [])[0] || ''), mealRaw: room.board || '',
      room: String(room.name || '').trim(), roomKey: String(room.room_code || ''), mealKey: String(room.board_code || ''),
      price: Math.round(price), avail: 'ok', seats: 'ok'
    });
  }
  return out;
}

// Asialuxe har so'rovda "standart" reysni o'zi tanlaydi va u har safar har xil bo'lishi mumkin (2026-11-26 sinovi: Istanbul,
// bir xil so'rovga navbat bilan CENTRUM $673 yoki NEMO $824 — paket narxi $157 ga sakraydi). Shuning uchun barcha reyslar olinadi
// (/v2/tour/flights) va narx eng arzon borish-qaytish reysi bilan hisoblanadi — bir xil so'rovga bir xil, eng past narx.
async function cheapestFlight(op, body, signal, fetchImpl, deadline) {
  const req = Object.assign({}, body);
  let flight = null;
  for (let i = 0; i < 5; i++) {
    const f = await call(op, 'POST', '/v2/tour/flights', req, signal, fetchImpl);
    if (f.flight && f.flight.offer_id) req.flight_offer_id = f.flight.offer_id;
    flight = f.flight || null;
    if (!f.pending && !(flight && flight.pending)) break;
    const wait = Math.min(10, Math.max(1, Number(f.poll_after) || 2)) * 1000;
    if (Date.now() + wait > deadline) break;
    await sleep(wait, signal);
  }
  const offers = ((flight && flight.offers) || []).filter(o => o && o.result_id && Number(o.total) > 0 && (!o.flight_trip || o.flight_trip === 'rt'));
  offers.sort((a, b) => Number(a.total) - Number(b.total));
  return offers[0] || null;
}

// Bitta shahar: javobda mehmonxonalar paydo bo'lguncha (reys yuklanayotganda "pending") qayta so'rash,
// so'ng narxni eng arzon reys bilan qayta hisoblash. flightId berilsa — o'sha reys bilan (mehmonxona filtri uchun qayta so'rov).
// Javob sahifalab keladi (pagination: page, last_page, has_more; 2026-11-27: Istanbul 12 × 30 = 332 mehmonxona).
// Oldin faqat 1-sahifaning 30 tasi olinardi. Endi sahifa 100 ta; keyingilari — "Operatordan yana yuklash" (q.page),
// o'sha reys bilan (preset) — narx 1-sahifadagidek bir xil reysdan hisoblanadi.
const PER_PAGE = 100;
const presets = new Map();
const PRESET_TTL = 30 * 60000;
async function listCity(op, q, city, filter, signal, fetchImpl, deadline, preset, pageNo = 1) {
  const body = {
    depute: q.fromCode, loc_id: Number(city.location_id), arrive: String(city.code).toUpperCase(),
    begin_date: q.date, end_date: shiftIso(q.date, q.nights), date_mode: 'fixed',
    rooms: [{ adult: q.adults, child_age: (q.childAges || []).slice(0, 4) }],
    platform: 'b2b_uz', cabin: 'Y', transfer: 'gr', flight_trip: 'rt', insurance: 'yes',
    wait_flights: true, page: pageNo, per_page: PER_PAGE, sort: 'price_asc'
  };
  if (filter) body.filter = filter;
  if (preset && preset.flightOfferId) body.flight_offer_id = preset.flightOfferId;
  if (preset && preset.flightId) body.flight_id = preset.flightId;
  let j = {};
  for (let i = 0; i < 8; i++) {
    j = await call(op, 'POST', '/v2/tour/list', body, signal, fetchImpl);
    if (j.flight && j.flight.offer_id) body.flight_offer_id = j.flight.offer_id;
    if (j.flight && j.flight.selected_id && !body.flight_id) body.flight_id = j.flight.selected_id;
    const pending = !!(j.pending || (j.flight && j.flight.pending));
    if ((j.hotels || []).length || !pending) break;
    const wait = Math.min(10, Math.max(1, Number(j.poll_after) || 2)) * 1000;
    if (Date.now() + wait > deadline) break;
    await sleep(wait, signal);
  }
  if (!preset && (j.hotels || []).length && body.flight_offer_id && Date.now() + 10000 < deadline) {
    try {
      const best = await cheapestFlight(op, body, signal, fetchImpl, deadline);
      const selected = ((j.flight && j.flight.offers) || []).find(o => o.result_id === (j.flight && j.flight.selected_id));
      if (best && best.result_id !== (selected && selected.result_id) && (!selected || Number(best.total) < Number(selected.total))) {
        body.flight_id = best.result_id;
        const again = await call(op, 'POST', '/v2/tour/list', body, signal, fetchImpl);
        if ((again.hotels || []).length) j = again;
      }
    } catch (error) {
      if (error && /^LIVE_AUTH/.test(error.code || '')) throw error;   // reyslar ro'yxati olinmasa — standart reys narxi qoladi
    }
  }
  j.__flight = { flightId: body.flight_id || null, flightOfferId: body.flight_offer_id || null };
  return j;
}

// q = { country, date, nights, adults, childAges, from, window, hotel? }
async function search(op, q, { fetchImpl = safeFetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  const deadline = Date.now() + TIMEOUT - 5000;
  try {
    const signal = ctl.signal;
    const fromCode = String(q.from || 'tas').toUpperCase();
    const { note, cities } = await citiesFor(op, fromCode, String(q.country).toUpperCase(), signal, fetchImpl, q.city);
    if (!cities.length) return { offers: [], note };
    const qq = Object.assign({}, q, { fromCode });
    const matchHotel = q.hotel ? hotelMatcher(q.hotel) : null;
    const page = matchHotel ? 1 : Math.max(1, q.page || 1);
    const results = await Promise.all(cities.map(async city => {
      try {
        // Reys (preset) shahar va so'rov bo'yicha eslab qolinadi: keyingi sahifalar o'sha reys bilan
        const pkey = [op.id, fromCode, city.code, q.date, q.nights, q.adults, (q.childAges || []).join('.')].join('|');
        if (page > 1) {
          let preset = presets.get(pkey);
          if (!preset || Date.now() - preset.at > PRESET_TTL) {
            const first = await listCity(op, qq, city, null, signal, fetchImpl, deadline);
            preset = { flight: first.__flight, at: Date.now() };
            presets.set(pkey, preset);
          }
          const jp = await listCity(op, qq, city, null, signal, fetchImpl, deadline, preset.flight, page);
          return { offers: parseHotels(op, jp, qq, city.name), more: !!(jp.pagination && jp.pagination.has_more) };
        }
        let j = await listCity(op, qq, city, null, signal, fetchImpl, deadline);
        if (!matchHotel) {
          presets.set(pkey, { flight: j.__flight, at: Date.now() });
          if (presets.size > 500) presets.delete(presets.keys().next().value);
          return { offers: parseHotels(op, j, qq, city.name), more: !!(j.pagination && j.pagination.has_more) };
        }
        if (matchHotel) {
          // Operator mehmonxona filtri mehmonxona kodini kutadi — kodlarni birinchi javobdagi ro'yxatdan (nom bo'yicha) olamiz
          const codes = ((j.filters && j.filters.hotel) || []).filter(h => h && h.code != null && matchHotel(h.name))
            .map(h => String(h.code)).slice(0, 20);
          const onPage = (j.hotels || []).filter(h => matchHotel(h.name));
          if (codes.length && onPage.length < codes.length) j = await listCity(op, qq, city, { hotel: codes }, signal, fetchImpl, deadline, j.__flight);
          else if (!codes.length && !onPage.length) return { offers: [], noHotel: true };
        }
        return { offers: parseHotels(op, j, qq, city.name) };
      } catch (error) {
        if (error && /^LIVE_AUTH/.test(error.code || '')) throw error;
        return { offers: [], error };
      }
    }));
    let offers = [].concat(...results.map(r => r.offers));
    if (matchHotel) offers = offers.filter(o => matchHotel(o.hotel));
    if (!offers.length) {
      const failed = results.filter(r => r.error);
      if (failed.length === results.length) throw failed[0].error;     // hamma shahar xato — operator xatosi
      return { offers: [], note: results.every(r => r.noHotel) ? 'no_hotel' : 'empty' };
    }
    const more = results.some(r => r.more);
    return { offers, note: '', more, next: more ? page + 1 : undefined, cityApplied: !!q.city };
  } finally { clearTimeout(timer); }
}

const authStatus = (id, env) => auth.status(id, env);
function resetAuth(id) { auth.reset(id); if (!id) cache.clear(); }

module.exports = { search, parseHotels, logon, authStatus, resetAuth, citiesFor, cityAliases, TIMEOUT, _call: call };
