/*
 * TezBooking — SAMO-Tour Online ulagichi (operatorning "Поиск тура" sahifasi).
 *
 * Ko'p tur operatorlar (Prestige, Kazunion, Selfie, Savtour, Vietratour, ...) SAMO tizimida ishlaydi va
 * "Поиск тура" sahifasi agentliklar uchun ochiq. Bu ulagich o'sha sahifa brauzerga beradigan so'rovni yuboradi
 * (samo_action=PRICES) va javobdagi narx qatorlarini o'qiydi. Hech qanday himoya chetlab o'tilmaydi.
 *
 * Agentlik kabineti: .env da operator logini bo'lsa (server/live/credentials.js), qidiruvdan oldin agentlikning
 * o'z login/paroli bilan oddiy kirish formasi orqali kiriladi (samo_action=logon) va qidiruv kabinet sessiyasida bajariladi.
 * Kirib bo'lmasa (noto'g'ri parol) — 30 daqiqa qayta urinilmaydi (hisob bloklanmasin), qidiruv ochiq sahifa orqali davom etadi.
 *
 * Operator API kalitini bergach, shu fayl o'rniga rasmiy SAMO export API'si ulanadi — natija formati o'zgarmaydi.
 *
 *   search(op, { country, date, nights, adults, childAges, from })  ->  { offers: [...], note }
 *   offer = { opId, hotelKey, hotel, stars, city, tour, gds, dep (uchish, daqiqa | null), depDate, fromCode, toCode,
 *             checkIn, nights, meal, mealRaw, room, roomKey, mealKey, price (USD), avail: ok|few|req|stop, seats: ok|few|none }
 */
'use strict';

const { createSafeFetch } = require('./safe-http');
const { createAuth, authError, mergeCookies, setCookiesOf } = require('./auth');
const { hotelMatcher } = require('./hotel-match');
const { cityMatcher } = require('../../js/cities.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 TezBooking/1.0';
// Bitta operator qidiruvi (barcha sahifalari bilan). FS Travel'ning 1000 qatorli sahifasi sekin tarmoqda 25 s dan oshardi.
const TIMEOUT = Number(process.env.LIVE_TIMEOUT_MS) || 40000;
const safeFetch = createSafeFetch({ timeoutMs: TIMEOUT });

// TezBooking davlat kodlari -> SAMO'dagi ruscha nomlar
const COUNTRY_RU = {
  tr: ['Турция'], ge: ['Грузия'], az: ['Азербайджан'], ae: ['ОАЭ', 'Объединенные Арабские Эмираты', 'Объединённые Арабские Эмираты'],
  eg: ['Египет'], my: ['Малайзия'], th: ['Таиланд', 'Тайланд'], vn: ['Вьетнам'], id: ['Индонезия', 'Бали'], lk: ['Шри-Ланка', 'Шри Ланка'], mv: ['Мальдивы']
};
// Jo'nash shaharlari (TezBooking kodi -> SAMO'dagi ruscha nomi). Ro'yxat js/data.js dagi FROM bilan bir xil.
const FROM_RU = {
  tas: ['Ташкент'], skd: ['Самарканд'], bhk: ['Бухара'], ugc: ['Ургенч'], nma: ['Наманган'], feg: ['Фергана'],
  azn: ['Андижан'], tmj: ['Термез'], nvi: ['Навои'], ksq: ['Карши'], ncu: ['Нукус'], dyu: ['Душанбе']
};
// GDS (muntazam reys, chipta GDS orqali) paketlar. 2026-11-24 da haqiqiy javoblarda tekshirilgan belgilar:
//   qator klassi "freight-external" (Easybooking), tur nomi "...(GDS)", ma'lumot ustuni "UZ-7255-IST+ GDS/...",
//   Prestige'da "Отели ОАЭ- dynamic (а/к ...)" — dinamik paket ham shu turdagi.
const GDS_RE = /\bGDS\b|регуляр|regular|рег\.\s*рейс|динамич|\bdynamic\b/i;

// SAMO valyuta kodlari (FlyKhiva, Easybooking sahifalaridagi CURRENCY ro'yxatidan, 2026-11-27)
const CURRENCY_CODE = { 2: 'USD', 3: 'EUR', 5: 'UZS' };
const ymd = (iso) => iso.replace(/-/g, '');
const isoFromYmd = (s) => s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

// SAMO javobi — JavaScript; ichidagi \uXXXX va \/ larni ochish
function unescapeJs(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, ' ');
}
const text = (html) => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
function options(js, ctl) {
  const m = js.match(new RegExp('controls\\.' + ctl + '\\)\\.addOptions\\(\\s*\\[([\\s\\S]*?)\\]'));
  if (!m) return [];
  return [...m[1].matchAll(/inc:\s*'(\d+)',\s*title:\s*'([^']*)'(?:,\s*selected:\s*(true|false))?/g)]
    .map(x => ({ inc: x[1], title: unescapeJs(x[2]), sel: x[3] === 'true' }));
}

// Ovqatlanish: SAMO matni -> TezBooking kodi
function mealCode(raw) {
  const s = String(raw || '').toUpperCase();
  if (/UAI|ULTRA/.test(s)) return 'UAI';
  if (/\bAI\b|ALL INC|\bALL\b|\bAL\b|ВСЕ ВКЛ|ВСЁ ВКЛ/.test(s)) return 'AI';
  if (/\bFB\b|FULL BOARD|ПОЛНЫЙ ПАНС|ТР[ЕЁ]ХРАЗ/.test(s)) return 'FB';
  if (/\bHB\b|HALF BOARD|ПОЛУПАНС|ДВУХРАЗ/.test(s)) return 'HB';
  if (/\bBB\b|BREAKFAST|\bABF\b|ЗАВТРАК/.test(s)) return 'BB';
  return 'RO';
}
// Mehmonxonada joy: Y — bor, R — so'rov bo'yicha, F/N/S — yo'q, L — kam
function availOf(cls) {
  const m = [...cls.matchAll(/hotel_availability_([A-Z])/g)].map(x => x[1]);
  if (!m.length) return 'req';
  if (m.includes('Y')) return 'ok';
  if (m.includes('L')) return 'few';
  if (m.includes('R')) return 'req';
  return 'stop';
}
// Reysdagi joy (borish va qaytish). Operatorning o'z yozuvi (title) birinchi: "есть места" / "мало мест" / "нет мест".
// Harf kodi faqat yozuv bo'lmasa: Y — bor, N — yo'q, F — kam ("мало мест", 2026-11-26 da Kazunion, FS Travel'da tekshirilgan),
// boshqa harf (R — so'rov bo'yicha, L) — kam deb olinadi. Oldin F "yo'q" deb o'qilib, kam joyli turlar chiqarib tashlanardi.
function seatState(code, title) {
  const t = String(title || '').toLowerCase();
  if (/нет мест|no seats|joy yo/.test(t)) return 'none';
  if (/мало|few|kam/.test(t)) return 'few';
  if (/есть|available|bor/.test(t)) return 'ok';
  if (code === 'Y') return 'ok';
  if (code === 'N') return 'none';
  return 'few';
}
function seatsOf(html) {
  const m = [...html.matchAll(/<[^>]*\bfr_place_[rl]\s+([A-Z])\b[^>]*>/g)].map(x => seatState(x[1], (x[0].match(/title="([^"]*)"/) || [])[1]));
  if (!m.length) return 'ok';
  if (m.some(s => s === 'none')) return 'none';
  if (m.some(s => s === 'few')) return 'few';
  return 'ok';
}

// ---------- So'rovlar (har bir operator uchun cookie sessiyasi) ----------
const sessions = new Map();          // opId|page -> { base, cookie, at }
const metaCache = new Map();         // opId|shahar -> { states, at }  (davlatlar ro'yxati, 6 soat)

async function http(op, url, opts, signal, fetchImpl = safeFetch) {
  const allowedOrigin = new URL(op.search).origin;
  const r = await fetchImpl(url, Object.assign({ signal, allowedOrigin }, opts));
  if (!r.ok) {
    const error = new Error('supplier request failed');
    error.code = 'LIVE_UPSTREAM_STATUS';
    error.status = r.status;
    throw error;
  }
  return r;
}

// ---------- Agentlik kabinetiga kirish (SAMO "logon" formasi) ----------
const LOGIN_FORM = /id="loginForm"/;

// Bitta kirish: kabinet sahifasi (cookie + logon_key) -> forma POST -> kabinetni qayta ochib tekshirish.
// Natija — kabinet sessiyasi cookie'si. Parol faqat operatorning o'z saytiga, forma tanasida yuboriladi.
async function logon(op, creds, signal, fetchImpl = safeFetch) {
  const origin = new URL(op.search).origin;
  const url = origin + '/cl_refer';
  const headers = { 'User-Agent': UA, Accept: 'text/html' };
  let r = await http(op, url, { headers }, signal, fetchImpl);
  let cookie = mergeCookies('', setCookiesOf(r));
  const page = await r.text();
  if (!LOGIN_FORM.test(page)) throw authError('LIVE_AUTH_NO_FORM');
  const key = (page.match(/name="logon_key"[^>]*value="([^"]*)"/) || [])[1] || '';
  const body = new URLSearchParams({
    logon_type: 'agency', samo_action: 'logon', logon_key: key, login: creds.login, password: creds.password
  }).toString();
  r = await fetchImpl(url, {
    method: 'POST', body, redirect: 'manual', signal, allowedOrigin: origin,
    headers: Object.assign({}, headers, { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Referer: url, Cookie: cookie })
  });
  if (r.status >= 400) throw Object.assign(new Error('supplier request failed'), { code: 'LIVE_UPSTREAM_STATUS', status: r.status });
  cookie = mergeCookies(cookie, setCookiesOf(r));
  // Kirgan bo'lsak kabinetda login formasi qolmaydi
  r = await http(op, url, { headers: Object.assign({}, headers, { Cookie: cookie }) }, signal, fetchImpl);
  cookie = mergeCookies(cookie, setCookiesOf(r));
  if (LOGIN_FORM.test(await r.text())) throw authError('LIVE_AUTH_FAILED');
  return cookie;
}

// Kabinet sessiyalari (server/live/auth.js): 20 daqiqa, noto'g'ri parol — 30 daqiqa qayta urinilmaydi
const auth = createAuth({ logon });
// Operatorning kabinet cookie'si ('' — login yo'q yoki kirib bo'lmadi: qidiruv ochiq sahifa orqali)
const authCookie = (op, signal, opts) => auth.session(op, signal, opts);
// Kirish holati (parolsiz): none — login berilmagan, pending — hali kirilmagan, authenticated | failed
const authStatus = (id, env) => auth.status(id, env);
// Login almashtirilganda (yoki testlarda) kabinet sessiyasini unutish
function resetAuth(id) {
  auth.reset(id);
  if (id) [...sessions.keys()].filter(k => k.startsWith(id + '|')).forEach(k => sessions.delete(k));
  else sessions.clear();
}
// page: search_tour (turlar) | search_hotel (faqat mehmonxona) | tickets (aviachiptalar)
const pageUrl = (op, page) => (page === 'search_tour' ? op.search : op.search.replace(/[^/]*$/, page));
const selectOptions = (html, name) => {
  const sel = html.match(new RegExp('<select[^>]*name="' + name + '"[^>]*>([\\s\\S]*?)</select>', 'i'));
  return sel ? [...sel[1].matchAll(/<option[^>]*value="([\d.]+)"[^>]*>([^<]+)/g)].map(x => ({ inc: x[1], title: x[2].trim() })) : [];
};
async function session(op, signal, page) {
  page = page || 'search_tour';
  const sk = op.id + '|' + page;
  const s = sessions.get(sk);
  if (s && Date.now() - s.at < 20 * 60000) return s;
  const loggedIn = await authCookie(op, signal);       // '' — loginsiz (ochiq sahifa)
  const headers = { 'User-Agent': UA, Accept: 'text/html' };
  if (loggedIn) headers.Cookie = loggedIn;
  const r = await http(op, pageUrl(op, page), { headers }, signal);
  const cookie = mergeCookies(loggedIn, setCookiesOf(r));
  const html = await r.text();
  // Jo'nash shaharlari va davlatlar sahifaning o'zida: <select name="TOWNFROMINC"> <option value="1853">Ташкент</option>
  const ns = { base: r.url.split('?')[0], cookie, towns: selectOptions(html, 'TOWNFROMINC'), states: selectOptions(html, 'STATEINC'), at: Date.now() };
  sessions.set(sk, ns);
  return ns;
}
async function samo(op, qs, signal, page) {
  const s = await session(op, signal, page);
  const r = await http(op, s.base + '?' + qs, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: s.base, Cookie: s.cookie } }, signal);
  return r.text();
}

// Tanlangan shahardan qaysi davlatlarga tur bor (6 soat keshda)
async function states(op, townInc, signal) {
  const k = op.id + '|' + townInc, c = metaCache.get(k);
  if (c && Date.now() - c.at < 6 * 3600000) return c.states;
  const st = options(await samo(op, 'samo_action=TOWNFROMINC&TOWNFROMINC=' + townInc, signal), 'STATEINC');
  metaCache.set(k, { states: st, at: Date.now() });
  return st;
}
// Davlatdagi mehmonxonalar ro'yxati (davlat tanlanganda sahifa oladigan "samo.hotelDynamic = [{"id":..,"name":..}]"), 6 soat keshda
// Shu so'rovning o'zida kurort shaharlar ham keladi (TOWNS): guruh (shahar, masalan "Стамбул", "Дубай") va uning ichidagi
// tumanlar kodlari (<label class="groupname">Дубай</label> ... <input type="checkbox" value="1354"/> Шарджа). 2026-11-27 sinovi:
// Easybooking BAA, TOWNS=1354 (Шарджа) -> 80 qatorning hammasi Шарджа; filtrsiz — Dubay, Abu-Dabi, Ajman aralash.
function parseTowns(html) {
  const at = html.indexOf('controls.TOWNS');
  if (at < 0) return [];
  const next = html.indexOf('controls.', at + 20);
  const block = html.slice(at, next > 0 ? next : undefined);
  const groups = [];
  const re = /<label class="groupname">[\s\S]*?\/>([^<]*)<\/label>|<input type="checkbox"\s+value="(\d+)"\s*\/>\s*([^<]*)<\/label>/g;
  let m, cur = null;
  while ((m = re.exec(block))) {
    if (m[1] !== undefined) { cur = { name: m[1].trim(), subs: [] }; groups.push(cur); continue; }
    const sub = { key: m[2], name: m[3].trim() };
    if (!cur) groups.push({ name: sub.name, subs: [sub] }); else cur.subs.push(sub);
  }
  return groups;
}
// Bir xil so'rov ikki marta yuborilmaydi (ketayotgani kutiladi). Javob katta bo'lishi mumkin (Kompas BAA: 2,4 MB, 34 s) —
// o'z vaqt chegarasi bilan, qidiruv bekor qilinsa ham fonda tugab keshga tushadi.
const metaPending = new Map();
async function stateMeta(op, townInc, stateInc, signal) {
  const k = op.id + '|' + townInc + '|' + stateInc + '|meta', c = metaCache.get(k);
  if (c && Date.now() - c.at < 6 * 3600000) return c;
  if (!metaPending.has(k)) {
    const p = (async () => {
      const js = await samo(op, 'samo_action=STATEINC&TOWNFROMINC=' + townInc + '&STATEINC=' + stateInc, AbortSignal.timeout(90000));
      const hotels = [];
      for (const m of js.matchAll(/\{"id":(\d+),"name":"((?:[^"\\]|\\.)*)"/g)) {
        try { hotels.push({ id: m[1], name: JSON.parse('"' + m[2] + '"') }); } catch (e) { /* buzilgan nom — o'tkazib yuboriladi */ }
      }
      const meta = { hotels, towns: parseTowns(unescapeJs(js)), at: Date.now() };
      metaCache.set(k, meta);
      return meta;
    })().finally(() => metaPending.delete(k));
    p.catch(() => {});
    metaPending.set(k, p);
  }
  const pending = metaPending.get(k);
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    pending.then(resolve, reject);
  });
}
// Shaharlar ro'yxati shuncha vaqtda kelmasa — qidiruv kutmaydi (natija shahar nomi bo'yicha saralanadi), ro'yxat fonda keshga tushadi
const META_WAIT_MS = 12000;
const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms).unref())]);
const hotelsOf = async (op, townInc, stateInc, signal) => (await stateMeta(op, townInc, stateInc, signal)).hotels;
// Tanlangan shahar -> operatorning TOWNS kodlari: guruh nomi mos kelsa — butun guruh, aks holda mos tumanlar
function townKeys(towns, match) {
  const keys = [];
  towns.forEach(g => {
    if (match(g.name)) g.subs.forEach(s => keys.push(s.key));
    else g.subs.forEach(s => { if (match(s.name)) keys.push(s.key); });
  });
  return [...new Set(keys)];
}
async function departure(op, from, signal) {
  const s = await session(op, signal);
  const want = (FROM_RU[from] || FROM_RU.tas).map(norm);
  return s.towns.find(t => want.includes(norm(t.title)));
}
const shiftIso = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tomorrowIso = () => shiftIso(new Date().toISOString().slice(0, 10), 1);

// ---------- Natija qatorlarini o'qish ----------
function parseRows(op, js) {
  const html = unescapeJs(js);
  const out = [];
  const rowRe = /<tr\s+class="([^"]*\bprice_info\b[^"]*)"([^>]*)>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const cls = m[1], attrs = m[2], body = m[3];
    const attr = (n) => (attrs.match(new RegExp('data-' + n + '="([^"]*)"')) || [])[1] || '';
    const key = (n) => (cls.match(new RegExp('\\b' + n + '-(\\d+)')) || [])[1] || '';
    const tds = [...body.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(x => ({ cls: x[1], html: x[2] }));
    const hotelTd = tds.find(t => /link-hotel/.test(t.cls));
    // Narx USD da (so'rovda CURRENCY=2). Operator narxi boshqa valyutada bo'lsa (Kompas, FlyKhiva Turkiyani EUR da beradi) —
    // operatorning o'zi so'ralgan valyutaga o'girgan narxi (data-converted-price-number; 2026-11-27: 987.19 EUR → 1083 USD).
    // Oldin bunday qatorlar tashlab yuborilardi va shu operatorlarning butun Turkiyasi ko'rinmasdi.
    const cat = body.match(/data-cat-price="([\d.]+)"[\s\S]*?data-cat-currency="(\d+)"/);
    const conv = body.match(/data-converted-price-number="([\d.]+)"/);
    if (!hotelTd || (!cat && !conv)) continue;
    const priceM = cat && cat[2] === '2' ? cat : conv;
    if (!priceM) continue;
    // "Consul Hotel *** (Баку)", "Rixos 5* (Antalya)", "SAN MARINO HOTEL ** (Dubai (Deira))" — oxirgi qavs (ichma-ich ham) shahar
    let rest = text(hotelTd.html), city = '';
    if (rest.endsWith(')')) {
      for (let i = rest.length - 1, d = 0; i >= 0; i--) {
        if (rest[i] === ')') d++;
        else if (rest[i] === '(' && --d === 0) { city = rest.slice(i + 1, -1).trim(); rest = rest.slice(0, i).trim(); break; }
      }
    }
    const sm = rest.match(/\s*(\*{1,5}|\d\s*\*)\s*$/);
    const stars = sm ? (/\d/.test(sm[1]) ? +sm[1].match(/\d/)[0] : sm[1].length) : 0;
    const name = (sm ? rest.slice(0, sm.index) : rest).trim();
    const plain = tds.map(t => text(t.html));
    const idx = tds.indexOf(hotelTd);
    const mealRaw = plain[idx + 2] || '';
    const room = plain[idx + 3] || '';
    const tourTd = tds.find(t => /\btour\b/.test(t.cls));
    const tour = tourTd ? text(tourTd.html) : '';
    // Uchish: <td class="arrival sortie ..."> 06.12.2026 <span data-popup="вылеты">10:25</span> — charter paketlarda bor
    const sortie = tds.find(t => /\bsortie\b/.test(t.cls));
    const depM = sortie && text(sortie.html).match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
    // Ma'lumot ustuni: "TAS-2-SSH" (qayerdan-…-qayerga) yoki "UZ-7255-IST+ GDS/…"
    const infoTd = tds.find(t => /\btype_price\b/.test(t.cls));
    const info = infoTd ? text(infoTd.html) : '';
    const route = info.match(/\b([A-Z]{3})-\d+-([A-Z]{3})\b/);
    out.push({
      opId: op.id, hotelKey: attr('hotel') || key('hotelKey'), hotel: name, stars: Math.min(5, stars), city,
      tour, gds: /\bfreight-external\b/.test(cls) || GDS_RE.test(tour) || /\bGDS\b/.test(info),
      dep: depM ? +depM[4] * 60 + +depM[5] : null, depDate: depM ? depM[3] + '-' + depM[2] + '-' + depM[1] : null,
      fromCode: route ? route[1] : '', toCode: route ? route[2] : '', checkIn: isoFromYmd(attr('checkin') || key('checkIn')), nights: +(attr('nights') || key('nights')),
      meal: mealCode(mealRaw), mealRaw, room, roomKey: key('roomKey'), mealKey: key('mealKey'),
      price: Math.round(parseFloat(priceM[1])), avail: availOf(body), seats: seatsOf(body),
      ...(cat && cat[2] !== '2' ? { opPrice: Math.round(parseFloat(cat[1])), opCurrency: CURRENCY_CODE[cat[2]] || cat[2] } : {})
    });
  }
  return out;
}

// ---------- Qidiruv ----------
// Operator natijasi sahifalab keladi (80–100 qator, FS Travel 1000), narx bo'yicha arzonidan qimmatiga (2026-11-27 da tekshirilgan).
// Turkiyada bitta kunga 40+ sahifa (Easybooking 3200+ paket) — hammasini bitta qidiruvda olish 3–4 daqiqa. Shuning uchun:
// birinchi qidiruvda tanlangan kunning eng arzon LIVE_MAX_PAGES sahifasi (parallel, PAGE_BATCH tadan), qolgani —
// so'ralganda (q.page: shu sahifadan boshlab yana LIVE_MORE_PAGES sahifa; sayt: "Operatordan yana yuklash").
const MAX_PAGES = Math.max(1, Math.min(20, Number(process.env.LIVE_MAX_PAGES) || 6));
const MORE_PAGES = Math.max(1, Math.min(20, Number(process.env.LIVE_MORE_PAGES) || 6));
const PAGE_BATCH = 3;                 // bitta operatorga bir vaqtda ko'pi bilan shuncha sahifa so'rovi
const BIG_PAGE = 500;                 // sahifasi shundan katta bo'lsa (FS Travel) — bir martada bitta sahifa
const rowKey = (r) => [r.hotelKey, r.checkIn, r.nights, r.roomKey, r.mealKey, r.tour, r.price].join('|');
// Sahifalagich: <span class="page" data-page="13"> — joriy sahifadan keyingisi bormi
const hasNextPage = (html, page) => [...html.matchAll(/data-page="(\d+)"/g)].some(m => +m[1] > page);
const PAGE_SIZE = new Map();
const countRows = (html) => (html.match(/<tr\s+class="[^"]*\bprice_info\b/g) || []).length;

// start..(start+count-1) sahifalar; { rows, more, next }: more — operatorda yana sahifa bor, next — undan keyingi so'raladigan sahifa
// onFirst — birinchi sahifa kelgach chaqiriladi (qo'shni kunlar so'rovi shundan keyin boshlanadi)
async function pages(op, qs, start, count, signal, deadline, onFirst) {
  // onFirst har qanday chiqishda chaqiriladi (xato, "временно недоступен") — kutib turgan so'rov osilib qolmasin
  try { return await pagesLoop(op, qs, start, count, signal, deadline, () => { if (onFirst) { const f = onFirst; onFirst = null; f(); } }); }
  finally { if (onFirst) onFirst(); }
}
async function pagesLoop(op, qs, start, count, signal, deadline, onFirst) {
  const rows = [], seen = new Set();
  // Birinchi sahifa doim yolg'iz so'raladi: sekin operatorda (Kompas BAA ~15 s/sahifa) 3 ta sahifa birdan so'ralsa,
  // birinchisi ham sekinlashib vaqt chegarasidan oshardi va butun qidiruv bekor bo'lardi. Keyingilari — PAGE_BATCH tadan
  // (sahifasi katta bo'lsa — FS Travel 1000 qator — bittadan).
  let next = start, more = true, batch = 1;
  const after = () => { const n = PAGE_SIZE.get(op.id); return n != null && n > BIG_PAGE ? 1 : PAGE_BATCH; };
  while (more && next < start + count) {
    if (next > start && Date.now() > deadline) break;       // vaqt tugadi — bor natija qoladi, "yana yuklash" mumkin
    const list = [];
    for (let i = 0; i < batch && next + i < start + count; i++) list.push(next + i);
    const got = await Promise.all(list.map(p => {
      const s = new URLSearchParams(qs); s.set('PRICEPAGE', String(p));
      return samo(op, s.toString(), signal).then(js => ({ p, html: unescapeJs(js), js }))
        .catch(error => { if (p === start) throw error; return null; });
    }));
    let halted = false;
    for (const g of got) {
      if (!g) { more = true; halted = true; break; }         // sahifa kelmadi — keyingi safar shundan boshlab
      if (g.p === start && /временно недоступен/.test(g.html)) return { rows, more: false, next, closed: true };
      const n = countRows(g.html);
      // Oldingi sahifa "keyingisi bor" degan, bu esa bo'sh — operator xatosi/yuklama (oxirgi sahifa bo'sh kelmaydi):
      // shu sahifadan qayta so'rash mumkin bo'lib qoladi ("yana yuklash")
      if (!n && g.p > start) { more = true; halted = true; break; }
      next = g.p + 1;
      const fresh = parseRows(op, g.js).filter(r => !seen.has(rowKey(r)));
      fresh.forEach(r => { seen.add(rowKey(r)); rows.push(r); });
      // FS Travel sahifalagich chiqarmaydi (1000 qatorli sahifa, keyingisi PRICEPAGE bilan; 2026-11-27: BAA 5 sahifa, 4997 paket):
      // sahifalagich yo'q va sahifa to'la bo'lsa — davomi bor deb olinadi (bo'sh keyingi sahifa "yo'q" deb tugatadi)
      more = n > 0 && (/class="pager"/.test(g.html) ? hasNextPage(g.html, g.p) : n >= BIG_PAGE);
      if (more) PAGE_SIZE.set(op.id, Math.max(n, PAGE_SIZE.get(op.id) || 0));
      if (!more) break;
    }
    onFirst();
    batch = after();
    if (halted) break;
  }
  return { rows, more, next };
}

async function search(op, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const town = await departure(op, q.from, ctl.signal);
    if (!town) return { offers: [], note: 'no_departure' };
    const want = (COUNTRY_RU[q.country] || []).map(norm);
    const st = (await states(op, town.inc, ctl.signal)).find(s => want.includes(norm(s.title)));
    if (!st) return { offers: [], note: 'no_country' };
    // Mehmonxona nomi berilgan bo'lsa — operatorning o'zida shu mehmonxonalar bo'yicha qidiruv (natija 1-sahifaga sig'adi)
    const matchHotel = q.hotel ? hotelMatcher(q.hotel) : null;
    let hotelIds = null;
    if (matchHotel) {
      hotelIds = (await hotelsOf(op, town.inc, st.inc, ctl.signal)).filter(h => matchHotel(h.name)).map(h => h.id).slice(0, 40);
      if (!hotelIds.length) return { offers: [], note: 'no_hotel' };
    }
    // Shahar (kurort) tanlangan bo'lsa — operatorning o'z TOWNS filtri bilan (tumanlarni operator o'zi biladi)
    let towns = null, cityByName = null;
    if (q.city) {
      const match = cityMatcher(q.city, q.country);
      if (!match) return { offers: [], note: 'no_city' };
      const meta = await within(stateMeta(op, town.inc, st.inc, ctl.signal).catch(() => null), META_WAIT_MS);
      if (meta) {
        towns = townKeys(meta.towns, match);
        if (!towns.length) return { offers: [], note: 'no_city' };
      } else cityByName = match;     // ro'yxat hali yo'q (sekin operator) — filtrsiz qidiruv, shahar nomi bo'yicha saralash
    }
    const ages = (q.childAges || []).slice(0, 4);
    const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const tomorrow = shift(new Date().toISOString().slice(0, 10), 1);
    const beg = shift(q.date, -(q.window || 0)) < tomorrow ? tomorrow : shift(q.date, -(q.window || 0));
    const end = shift(q.date, q.window || 0);
    const qsFor = (from, till) => {
      const qs = new URLSearchParams({
        samo_action: 'PRICES', TOWNFROMINC: town.inc, STATEINC: st.inc, TOURINC: '0', FREIGHTTYPE: '0',
        CHECKIN_BEG: ymd(from), CHECKIN_END: ymd(till), NIGHTS_FROM: String(q.nights), NIGHTS_TILL: String(q.nights),
        ADULT: String(q.adults), CHILD: String(ages.length), CURRENCY: '2', PRICEPAGE: '1', DOLOAD: '1'
      });
      ages.forEach((a, i) => qs.set('AGES' + (i + 1), String(a)));
      if (ages.length) qs.set('AGES', ages.join(','));
      if (hotelIds) { qs.set('HOTELS', hotelIds.join(',')); qs.set('HOTELS_ANY', '0'); }
      if (towns) { qs.set('TOWNS', towns.join(',')); qs.set('TOWNS_ANY', '0'); }
      return qs.toString();
    };
    const deadline = started + TIMEOUT - 12000;
    const page = Math.max(1, q.page || 1);
    // Tanlangan kun — alohida so'rov va to'liq (eng arzonidan boshlab sahifalar). Oldin ±3 kun bitta so'rovda edi:
    // narx bo'yicha saralangan 5 sahifaning faqat ~1/7 qismi tanlangan kunga tushardi (Easybooking: 2370 tadan 19 tasi).
    const dayOk = q.date >= tomorrow;
    // Qo'shni kunlar so'rovi tanlangan kunning birinchi sahifasidan keyin boshlanadi (u bilan raqobatlashmasin)
    let firstDone;
    const firstPage = new Promise(resolve => { firstDone = resolve; });
    const dayP = dayOk ? pages(op, qsFor(q.date, q.date), page, page > 1 ? MORE_PAGES : MAX_PAGES, ctl.signal, deadline, firstDone) : null;
    if (!dayOk) firstDone();
    // Qo'shni kunlar (sayt kunlar tasmasi): ±window bo'yicha faqat birinchi sahifa — har kunning eng arzonlari
    const windowP = page === 1 && (q.window || !dayOk)
      ? firstPage.then(() => pages(op, qsFor(beg, end), 1, dayOk ? 1 : MAX_PAGES, ctl.signal, deadline))
        .catch(error => { if (!dayOk) throw error; return { rows: [] }; })
      : null;
    const day = dayP ? await dayP : { rows: [], more: false, next: 1 };
    const around = windowP ? await windowP : { rows: [] };
    if (day.closed) return { offers: [], note: 'closed' };
    const seen = new Set(day.rows.map(rowKey));
    const rows = day.rows.concat(around.rows.filter(r => (!dayOk || r.checkIn !== q.date) && !seen.has(rowKey(r))));
    const offers = rows.filter(o => o.checkIn >= beg && o.checkIn <= end && o.nights === q.nights
      && (!matchHotel || matchHotel(o.hotel))            // operator filtrni e'tiborsiz qoldirsa ham — faqat so'ralgan mehmonxona
      && (!cityByName || cityByName(o.city) || cityByName(o.hotel)));
    // more/next: tanlangan kun bo'yicha operatorda yana paketlar bor (keyingi so'rov: page = next)
    return { offers, note: offers.length ? '' : 'empty', more: !!(dayOk && day.more), next: day.next, cityApplied: !!towns };
  } finally {
    clearTimeout(timer);
    ctl.abort();          // xato bilan chiqilganda ortda qolgan so'rovlar (qo'shni kunlar) ham to'xtaydi
  }
}

// ---------- Faqat mehmonxona (search_hotel): reyssiz narx ----------
// q = { country, date, nights, adults, childAges, window }
async function searchHotels(op, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    let s;
    try { s = await session(op, ctl.signal, 'search_hotel'); }
    catch (e) { if (e.status === 404) return { offers: [], note: 'no_page' }; throw e; }   // operatorda "faqat mehmonxona" sahifasi yo'q
    const want = (COUNTRY_RU[q.country] || []).map(norm);
    let st = s.states.find(x => want.includes(norm(x.title)));
    if (!st) st = options(await samo(op, 'samo_action=STATEINC', ctl.signal, 'search_hotel'), 'STATEINC').find(x => want.includes(norm(x.title)));
    if (!st) return { offers: [], note: 'no_country' };
    const tm = tomorrowIso();
    const beg = shiftIso(q.date, -(q.window || 0)) < tm ? tm : shiftIso(q.date, -(q.window || 0));
    const end = shiftIso(q.date, q.window || 0);
    const ages = (q.childAges || []).slice(0, 4);
    const qs = new URLSearchParams({
      samo_action: 'PRICES', STATEINC: st.inc, TOURINC: '0', CHECKIN_BEG: ymd(beg), CHECKIN_END: ymd(end),
      NIGHTS_FROM: String(q.nights), NIGHTS_TILL: String(q.nights), ADULT: String(q.adults), CHILD: String(ages.length),
      CURRENCY: '2', PRICEPAGE: '1', DOLOAD: '1'
    });
    ages.forEach((a, i) => qs.set('AGES' + (i + 1), String(a)));
    const js = await samo(op, qs.toString(), ctl.signal, 'search_hotel');
    if (/временно недоступен/.test(unescapeJs(js))) return { offers: [], note: 'closed' };
    const offers = parseRows(op, js).filter(o => o.checkIn >= beg && o.checkIn <= end && o.nights === q.nights);
    return { offers, note: offers.length ? '' : 'empty' };
  } finally { clearTimeout(timer); }
}

// ---------- Aviachiptalar (tickets): charter va blok reyslar ----------
// q = { to (davlat kodi), from, date, ret|null, adults, childAges, cabin: eco|bus, window }
const dmyOf = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
const isoOfDmy = (s) => { const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const minutes = (hhmm) => { const m = String(hhmm || '').match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : 0; };
// Reys bor kunlar: datePicker({"start":"19.11.2026","valid":"0001000..."}) — har bir raqam bitta kun
function validDays(js, ctl) {
  const m = js.match(new RegExp('controls\\.' + ctl + '\\)\\.datePicker\\(\\{[^}]*?"start":"([^"]+)","valid":"([0-9]+)"'));
  if (!m) return [];
  const start = isoOfDmy(m[1]), out = [];
  for (let i = 0; i < m[2].length; i++) if (m[2][i] !== '0') out.push(shiftIso(start, i));
  return out;
}
// Qayerga uchish mumkin: davlatlar bo'yicha guruhlangan shaharlar
function destGroups(js) {
  const m = js.match(/controls\.TOWNTOINC\)\.addOptions\(\s*\[([\s\S]*?)\]\s*\);/);
  if (!m) return [];
  return [...m[1].matchAll(/\{title:\s*'([^']*)',\s*children:\s*\[([\s\S]*?)\]\s*\}/g)].map(g => ({
    country: unescapeJs(g[1]),
    towns: [...g[2].matchAll(/inc:\s*'([\d.]+)',\s*title:\s*'([^']*)'/g)].map(x => ({ inc: x[1].split('.')[0], title: unescapeJs(x[2]) }))
  }));
}
// "marker = [ ... ]" dagi JSON massivni qavslarni sanab ajratish (satr ichidagi qavslar hisobga olinmaydi)
function jsonArrayAfter(js, marker) {
  let i = js.indexOf(marker);
  if (i < 0) return null;
  i = js.indexOf('[', i);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < js.length; j++) {
    const c = js[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(js.slice(i, j + 1)); } catch (e) { return null; } } }
  }
  return null;
}
function seatsCode(status, text) {
  const code = typeof status === 'number' || /^\d+$/.test(String(status)) ? Number(status) : null;
  if (/нет мест/i.test(text || '') || code === 0) return 'none';
  if (/мало/i.test(text || '') || code === 3) return 'few';
  return 'unknown';
}
async function searchFlights(op, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    let s;
    try { s = await session(op, ctl.signal, 'tickets'); }
    catch (e) { if (e.status === 404) return { offers: [], note: 'no_page' }; throw e; }   // operatorda aviachipta sahifasi yo'q
    const wantFrom = (FROM_RU[q.from] || FROM_RU.tas).map(norm);
    const from = s.towns.find(t => wantFrom.some(w => norm(t.title).indexOf(w) === 0));
    if (!from) return { offers: [], note: 'no_departure' };
    const fromInc = from.inc.split('.')[0];
    const want = (COUNTRY_RU[q.to] || []).map(norm);
    const groups = destGroups(await samo(op, 'samo_action=TOWNFROMINC&TOWNFROMINC=' + fromInc, ctl.signal, 'tickets'));
    const towns = [].concat(...groups.filter(g => want.includes(norm(g.country))).map(g => g.towns)).slice(0, 3);
    if (!towns.length) return { offers: [], note: 'no_country' };
    const w = q.window || 0;
    const tm = tomorrowIso();
    const beg = shiftIso(q.date, -w) < tm ? tm : shiftIso(q.date, -w), end = shiftIso(q.date, w);
    const offers = [];
    for (const town of towns) {
      // Reys bor kunlardan tanlangan sanaga eng yaqinini olamiz (charter har kuni uchmaydi)
      const days = validDays(await samo(op, `samo_action=TOWNTOINC&TOWNFROMINC=${fromInc}&TOWNTOINC=${town.inc}`, ctl.signal, 'tickets'), 'CHECKIN')
        .filter(d => d >= beg && d <= end);
      if (!days.length) continue;
      const near = days.slice().sort((a, b) => Math.abs(Date.parse(a) - Date.parse(q.date)) - Math.abs(Date.parse(b) - Date.parse(q.date)))[0];
      const ages = (q.childAges || []).slice(0, 3);
      const p = new URLSearchParams({
        samo_action: 'PRICES', TOWNFROMINC: fromInc, TOWNTOINC: town.inc, CHECKIN: dmyOf(near), CHECKIN_DELTA: String(Math.max(w, 1)),
        ADULT: String(q.adults), CHILD: String(ages.length), CLASS: q.cabin === 'bus' ? '1' : '0', AIRLINE: '0', CURRENCYINC: '2',
        DIRECT_FLIGHT: '0', YESPLACES: '1'
      });
      ages.forEach((a, i) => p.set('age' + (i + 1), String(a)));
      if (q.ret) { p.set('ONEWAY', '0'); p.set('FREIGHTBACK', '1'); p.set('CHECKOUT', dmyOf(q.ret)); p.set('CHECKOUT_DELTA', String(Math.max(w, 1))); }
      else { p.set('ONEWAY', '1'); p.set('FREIGHTBACK', '0'); }
      const js = await samo(op, p.toString(), ctl.signal, 'tickets');
      const list = jsonArrayAfter(js, 'samo.priceAirlines');
      if (!list) continue;
      list.forEach(f => {
        if (+f.CurrencyInc !== 2) return;
        const date = isoOfDmy(f.DateBeg);
        if (!date || date < beg || date > end) return;
        const back = q.ret && f.DateBegBack ? {
          date: isoOfDmy(f.DateBegBack), no: f.FreightNameBack, dep: minutes(f.SrcTimeBack), arr: minutes(f.TrgTimeBack), dur: minutes(f.FlyTimeBack),
          fromCode: f.SrcPortAliasBack, toCode: f.TrgPortAliasBack, seats: seatsCode(f.BlockStatusOut, f.BlockCountOut)
        } : null;
        if (q.ret && !back) return;
        const seats = seatsCode(f.BlockStatusIn, f.BlockCountIn);
        if (seats === 'none' || (back && back.seats === 'none')) return;
        offers.push({
          opId: op.id, freight: String(f.FreightInc) + (back ? '-' + f.FreightIncBack : ''), airline: f.PartnerInName || '', no: f.FreightName || '',
          aircraft: f.TranTypeNameIn || '', fromCode: f.SrcPortAlias, fromCity: f.SrcTownName, toCode: f.TrgPortAlias, toCity: f.TrgTownName,
          date, dep: minutes(f.SrcTime), arr: minutes(f.TrgTime), dur: minutes(f.FlyTimeTo), back,
          price: Math.round(+f.TotalCost), seats: back && back.seats === 'few' ? 'few' : seats, bagKg: null, direct: null
        });
      });
    }
    return { offers, note: offers.length ? '' : 'empty' };
  } finally { clearTimeout(timer); }
}

module.exports = {
  search, searchHotels, searchFlights, parseRows, parseTowns, townKeys, mealCode, seatsCode, seatsOf, COUNTRY_RU, FROM_RU, GDS_RE,
  logon, authCookie, authStatus, resetAuth, mergeCookies
};
