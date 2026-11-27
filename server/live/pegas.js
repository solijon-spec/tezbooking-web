'use strict';

/*
 * TezBooking — Pegas Touristik (uz.pegast.asia) ulagichi: agentlik kabineti orqali tur paketlar.
 *
 * Pegas'da ochiq qidiruv yo'q — faqat agentlik logini bilan (.env: OPERATOR_PEGAS_LOGIN / _PASSWORD).
 * Kabinet sahifasining o'zi brauzerdan yuboradigan JSON so'rovlar ishlatiladi, hech qanday himoya chetlab o'tilmaydi:
 *   POST /Account/Login              {Username, Password} + antiforgery token  -> sessiya cookie
 *   POST /PackageSearch/GetInitialOptions  yo'nalishlar (uchish shahri -> davlat) va nomlar lug'ati (12 soat keshda)
 *   POST /PackageSearch/GetOptions         davlatdagi mehmonxonalar (mehmonxona nomi bo'yicha qidiruv uchun, 6 soat)
 *   POST /PackageSearch/Search             paketlar, narx USD da (PaymentCurrencyId=37)
 * Natija formati samo.js bilan bir xil (opId, hotel, stars, city, checkIn, nights, meal, room, price, avail, seats, ...).
 */

const { createSafeFetch } = require('./safe-http');
const { createAuth, authError, mergeCookies, setCookiesOf } = require('./auth');
const { hotelMatcher } = require('./hotel-match');
const { cityMatcher } = require('../../js/cities.js');
const { mealCode, COUNTRY_RU, FROM_RU } = require('./samo');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 TezBooking/1.0';
const TIMEOUT = Number(process.env.LIVE_SLOW_TIMEOUT_MS) || 90000;
const safeFetch = createSafeFetch({ timeoutMs: TIMEOUT, maxResponseBytes: 24 * 1024 * 1024 });
const USD_ID = 37;
const DAY = 86400000;

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const shiftIso = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const minutesOf = (dt) => { const m = String(dt || '').match(/T(\d{2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const originOf = (op) => new URL(op.search).origin;

// ---------- Kirish ----------
async function logon(op, creds, signal, fetchImpl = safeFetch) {
  const origin = originOf(op);
  const url = origin + '/Account/Login';
  let r = await fetchImpl(url, { signal, allowedOrigin: origin, headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!r.ok) throw Object.assign(new Error('supplier request failed'), { code: 'LIVE_UPSTREAM_STATUS', status: r.status });
  let cookie = mergeCookies('', setCookiesOf(r));
  const page = await r.text();
  const token = (page.match(/id="RequestVerificationToken"[^>]*value="([^"]+)"/)
    || page.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1];
  if (!token) throw authError('LIVE_AUTH_NO_FORM');
  r = await fetchImpl(url, {
    method: 'POST', redirect: 'manual', signal, allowedOrigin: origin,
    body: JSON.stringify({ Username: creds.login, Password: creds.password }),
    headers: {
      'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
      'X-Requested-With': 'XMLHttpRequest', RequestVerificationToken: token, Cookie: cookie, Origin: origin, Referer: url
    }
  });
  if (r.status >= 500) throw Object.assign(new Error('supplier request failed'), { code: 'LIVE_UPSTREAM_STATUS', status: r.status });
  cookie = mergeCookies(cookie, setCookiesOf(r));
  let answer = null;
  try { answer = JSON.parse(await r.text()); } catch (e) { answer = null; }
  if (!answer || answer.IsSucceeded !== true) throw authError('LIVE_AUTH_FAILED');
  return cookie;
}

const auth = createAuth({ logon });

// Kabinet so'rovi (JSON POST). Sessiya yopilgan bo'lsa (401 / UserSessionClosed) — bir marta qayta kirib takrorlanadi.
async function call(op, path, body, signal, fetchImpl = safeFetch, retried = false) {
  const cookie = await auth.session(op, signal, { fetchImpl });
  if (!cookie) throw authError('LIVE_AUTH_REQUIRED');
  const origin = originOf(op);
  const r = await fetchImpl(origin + path, {
    method: 'POST', signal, allowedOrigin: origin, body: JSON.stringify(body),
    headers: {
      'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
      'X-Requested-With': 'XMLHttpRequest', Cookie: cookie, Origin: origin, Referer: origin + '/PackageSearch'
    }
  });
  let data = null;
  if (r.status === 200) { try { data = JSON.parse(await r.text()); } catch (e) { data = null; } }
  const closed = r.status === 401 || r.status === 302 || (data && data.UserSessionClosed === true);
  if (closed && !retried) {
    auth.expire(op.id);
    return call(op, path, body, signal, fetchImpl, true);
  }
  if (!data || data.IsSucceeded === false) {
    throw Object.assign(new Error('supplier request failed'), { code: 'LIVE_UPSTREAM_STATUS', status: r.status });
  }
  return data;
}

// ---------- Ma'lumotnomalar ----------
const cache = new Map();   // kalit -> { value, at }
async function cached(key, ttl, load) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.value;
  const value = await load();
  cache.set(key, { value, at: Date.now() });
  return value;
}

// Yo'nalishlar: [{ dli (uchish joyi), dci (davlat), rli }] va nomlar (id -> ruscha nom)
function initialOptions(op, signal, fetchImpl) {
  return cached(op.id + '|init', 12 * 3600000, async () => {
    const j = await call(op, '/PackageSearch/GetInitialOptions', { search: null, clear: true }, signal, fetchImpl);
    const so = j.so || {};
    return { directions: so.di || [], names: (so.re && so.re.soitni) || {} };
  });
}

function idsByName(names, wanted) {
  const want = wanted.map(norm);
  return Object.keys(names).filter(id => want.includes(norm(names[id]))).map(Number);
}

// Davlatdagi mehmonxonalar [{ id, name }] va joylar daraxti: hudud (ty 0, "Анталья") -> shahar (ty 1, "Кемер") -> tuman (ty 2)
// (GetOptions, Groups 128: ho.op, ho.gt; 2026-11-27 da tekshirilgan)
function optionsOf(op, dep, country, beg, end, signal, fetchImpl) {
  return cached([op.id, dep, country, beg, end, 'options'].join('|'), 6 * 3600000, async () => {
    const j = await call(op, '/PackageSearch/GetOptions', {
      DepartureLocationId: dep, DestinationCountryId: country, ReturnLocationId: dep, DestinationLocationId: null,
      MinOutgoingDate: beg + 'T00:00:00', MaxOutgoingDate: end + 'T00:00:00', ReturnOptionsForExternalServices: false,
      Groups: 128   // HotelOptions
    }, signal, fetchImpl);
    const names = (j.re && j.re.soitni) || {};
    const places = [];
    const walk = (nodes) => (nodes || []).forEach(n => { places.push({ id: n.id, level: n.ty, name: names[n.id] || '' }); walk(n.ch); });
    walk(j.ho && j.ho.gt);
    return {
      hotels: ((j.ho && j.ho.op) || []).map(h => ({ id: h.hi, name: names[h.hi] || '' })).filter(h => h.name),
      places: places.filter(p => p.name)
    };
  });
}
const hotelsOf = async (...args) => (await optionsOf(...args)).hotels;
// Tanlangan shahar -> Pegas qidiruv maydonlari: mos hudud bo'lsa — butun hudud, aks holda mos shaharlar, aks holda tumanlar
function placeFilter(places, match) {
  for (const [level, field] of [[0, 'HotelRegionIds'], [1, 'HotelLocationIds'], [2, 'HotelLocationAreaIds']]) {
    const ids = places.filter(p => p.level === level && match(p.name)).map(p => p.id);
    if (ids.length) return { [field]: ids };
  }
  return null;
}

// ---------- Natijalar ----------
// Mavjudlik: 0 — bor, 1 — kam, 2 — so'rov bo'yicha, 3 — yo'q
const HOTEL_AVAIL = { 0: 'ok', 1: 'few', 2: 'req', 3: 'stop' };
function seatsOf(flights) {
  const codes = (flights || []).map(f => f.Availability);
  if (codes.some(c => c === 3)) return 'none';
  if (codes.some(c => c === 1 || c === 2)) return 'few';
  return 'ok';
}

function parseItems(op, j) {
  const ref = j.Reference || {};
  const names = ref.soitni || {};
  const hotels = ref.IdToHotelIndex || {};
  const meals = ref.IdToMealIndex || {};
  const airports = ref.IdToAirportIndex || {};
  const packages = ref.IdToPackageIndex || {};
  const currencies = ref.IdToCurrencyIndex || {};
  const regionOf = ref.LocationIdToRegionIdIndex || {};
  const out = [];
  for (const item of j.Items || []) {
    const hs = (item.HotelServices || []).find(h => h.IsMainHotel) || (item.HotelServices || [])[0];
    const currency = currencies[item.CurrencyId];
    if (!hs || !currency || currency.co !== 'USD' || !(item.Price > 0)) continue;
    const name = names[hs.HotelId];
    if (!name) continue;
    const hotel = hotels[hs.HotelId] || {};
    const starText = names[hotel.CategoryGroupId] || names[hotel.CategoryId] || '';
    const stars = Number((starText.match(/[1-5]/) || [])[0]) || (hotel.CategoryRating >= 10 ? Math.min(5, Math.round(hotel.CategoryRating / 10)) : 0);
    const city = [...new Set([names[regionOf[hotel.LocationId]], names[hotel.LocationId], names[hotel.LocationAreaId]].filter(Boolean))].join(', ');
    const meal = meals[hs.MealId] || {};
    const flights = item.FlightServices || [];
    const outbound = flights[0] && flights[0].Segments ? flights[0].Segments : [];
    const first = outbound[0], last = outbound[outbound.length - 1];
    out.push({
      opId: op.id, hotelKey: String(hs.HotelId), hotel: name, stars, city,
      tour: (packages[item.PackageId] || {}).na ? String(packages[item.PackageId].na).trim() : '',
      gds: !!item.HasExternalServices,
      dep: first ? minutesOf(first.DepartureDateTime) : null,
      depDate: first ? String(first.DepartureDateTime).slice(0, 10) : null,
      fromCode: first && airports[first.DepartureAirportId] ? airports[first.DepartureAirportId].Code : '',
      toCode: last && airports[last.ArrivalAirportId] ? airports[last.ArrivalAirportId].Code : '',
      checkIn: String(hs.CheckInDate || '').slice(0, 10), nights: hs.DurationInNights || item.Duration,
      meal: mealCode(meal.Code || names[hs.MealId] || ''), mealRaw: meal.Code || names[hs.MealId] || '',
      room: [names[hs.RoomCategoryId], hs.Accommodation].filter(Boolean).join(' / '),
      roomKey: String(hs.RoomCategoryId || ''), mealKey: String(hs.MealId || ''),
      price: Math.round(item.Price), avail: HOTEL_AVAIL[hs.Availability] || 'req', seats: seatsOf(flights)
    });
  }
  return out;
}

// ---------- Qidiruv ----------
// q = { country, date, nights, adults, childAges, from, window, hotel? }  (server/live/validation.js)
async function search(op, q, { fetchImpl = safeFetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const signal = ctl.signal;
    const { directions, names } = await initialOptions(op, signal, fetchImpl);
    const depIds = idsByName(names, FROM_RU[q.from] || FROM_RU.tas).filter(id => directions.some(d => d.dli === id));
    if (!depIds.length) return { offers: [], note: 'no_departure' };
    const dep = depIds[0];
    const countryIds = idsByName(names, COUNTRY_RU[q.country] || []);
    const direction = directions.find(d => d.dli === dep && countryIds.includes(d.dci));
    if (!direction) return { offers: [], note: 'no_country' };
    const tomorrow = shiftIso(new Date().toISOString().slice(0, 10), 1);
    const w = q.window || 0;
    const beg = shiftIso(q.date, -w) < tomorrow ? tomorrow : shiftIso(q.date, -w);
    const end = shiftIso(q.date, w);
    const dates = [];
    for (let d = beg; d <= end; d = shiftIso(d, 1)) dates.push(d + 'T00:00:00');
    const matchHotel = q.hotel ? hotelMatcher(q.hotel) : null;
    let hotelIds = null;
    if (matchHotel) {
      hotelIds = (await hotelsOf(op, dep, direction.dci, beg, end, signal, fetchImpl)).filter(h => matchHotel(h.name)).map(h => h.id).slice(0, 50);
      if (!hotelIds.length) return { offers: [], note: 'no_hotel' };
    }
    // Shahar (kurort) tanlangan bo'lsa — Pegas'ning o'z hudud/shahar filtri bilan
    let place = null;
    if (q.city) {
      const match = cityMatcher(q.city, q.country);
      place = match ? placeFilter((await optionsOf(op, dep, direction.dci, beg, end, signal, fetchImpl)).places, match) : null;
      if (!place) return { offers: [], note: 'no_city' };
    }
    const ages = (q.childAges || []).slice(0, 4);
    const j = await call(op, '/PackageSearch/Search', Object.assign({
      DepartureLocationId: dep, ReturnLocationId: direction.rli || dep, DestinationCountryId: direction.dci, DestinationLocationId: null,
      Adults: q.adults, ChildAges: ages.length ? ages : null, DepartureDates: dates, DurationsInNights: [q.nights], ReturnDates: [],
      PackageId: null, PackageSpoTypeIds: null, BasicFares: null, PaymentCurrencyId: USD_ID, MinPrice: null, MaxPrice: null,
      HotelRegionIds: null, HotelLocationIds: null, HotelLocationAreaIds: null, HotelCategoryGroupIds: null, HotelMealGroupIds: null,
      HotelAttributeIds: null, HotelIds: hotelIds, AirlineIds: null, OutgoingFlightClassId: null, ReturnFlightClassId: null,
      DirectFlightsOnly: false, HotelAvailabilityAvailable: true, HotelAvailabilityOnRequest: true,
      FlightAvailabilityAvailable: true, FlightAvailabilityOnRequest: true, GroupByHotel: false,
      RenderAlternativeReturnLocations: false, LanguageCode: null, ShowPackagesWithExternalServices: false,
      OutgoingFlightClassType: null, ReturnFlightClassType: null, OutgoingDatesPeriodModel: null, ReturnDatesPeriodModel: null
    }, place || {}), signal, fetchImpl);
    const offers = parseItems(op, j).filter(o => o.checkIn >= beg && o.checkIn <= end && o.nights === q.nights
      && (!matchHotel || matchHotel(o.hotel)));
    return { offers, note: offers.length ? '' : 'empty', cityApplied: !!place };
  } finally { clearTimeout(timer); }
}

const authStatus = (id, env) => auth.status(id, env);
function resetAuth(id) { auth.reset(id); if (!id) cache.clear(); }

module.exports = { search, parseItems, placeFilter, logon, authStatus, resetAuth, call, _auth: auth };
