/*
 * TezBooking — demo ma'lumotlar va narx hisoblash.
 *
 * DIQQAT: operatorlar haqiqiy (OPS), lekin mehmonxonalar va narxlar hozircha o'ylab topilgan (demo).
 * Haqiqiy versiyada offersFor() o'rniga turoperatorlarning API'si (masalan, SAMO XML-shlyuzi) ishlatiladi.
 * Interfeys (app.js) har bir taklifni quyidagi ko'rinishda kutadi:
 *   { key, op: {id, name, color}, meal: 'BB'|'HB'|'AI'|'UAI', room: 'std'|'sup'|'dlx', price,
 *     avail: 'ok'|'few'|'req'|'stop', seats: 'ok'|'few'|'none', instant: true|false }
 * Nomlar (davlat, shahar, ovqat, xona) tilga qarab js/i18n.js dan olinadi.
 */
(function (global) {
  'use strict';

  // ---------- Turoperatorlar ----------
  // Haqiqiy operatorlar va ularning agentlik kabinetlari (B2B). Narxlar hozircha DEMO:
  // operator TezBooking'ga API kalitini bergach, shu operator uchun offersFor() o'rniga uning API'si ulanadi.
  //   sys:       samo — SAMO-Tour Online (bitta ulagich hammasiga), pegas — Pegas Touristik, api — XML/API (RezLive), own — o'z tizimi
  //   countries: faqat shu yo'nalishlar (yo'q bo'lsa — barchasi), hotelOnly: faqat mehmonxona (Mehmonxonalar bo'limi)
  //   live:      true — API ulangan (haqiqiy narxlar). Hozircha hammasi false.
  const OPS = [
    { id: 'anex', name: 'ANEX Tour', site: 'https://b2b.anextour.uz/', sys: 'samo', color: '#E30613', f: 1.0 },
    { id: 'kompas', name: 'Kompas Tour', site: 'https://online.uz.kompastour.com/search_tour', sys: 'samo', color: '#0057B8', f: 1.01 },
    { id: 'fstravel', name: 'FUN&SUN', site: 'https://b2b.fstravel.asia/', sys: 'samo', color: '#F28C00', f: 1.02 },
    { id: 'pegas', name: 'Pegas Touristik', site: 'https://uz.pegast.asia/PackageSearch', sys: 'pegas', color: '#D2232A', f: 0.995 },
    { id: 'crystalbay', name: 'Crystal Bay', site: 'https://booking.crystalbay.com/search_tour', sys: 'samo', color: '#00A3C4', f: 1.03 },
    { id: 'kazunion', name: 'Kazunion', site: 'https://online.kazunion.com/', sys: 'samo', color: '#1B4F9C', f: 0.99 },
    { id: 'kazunionae', name: 'Kazunion UAE', site: 'https://uae.kazunion.com', sys: 'own', countries: ['ae'], color: '#2A6FCB', f: 0.98 },
    { id: 'centrum', name: 'Centrum Holidays', site: 'https://online.centrum-holidays.com/search_tour', sys: 'samo', color: '#6D28D9', f: 1.015 },
    { id: 'prestige', name: 'Prestige', site: 'http://online.uz-prestige.com/', sys: 'samo', color: '#B8860B', f: 1.04 },
    { id: 'asialuxe', name: 'Asialuxe Travel', site: 'https://b2b.asialuxe.uz/login', sys: 'own', color: '#0F766E', f: 1.025 },
    { id: 'aqua', name: 'Aqua Travel Group', site: 'https://agency.aqua-travelgroup.com/tour-package', sys: 'samo', color: '#0EA5E9', f: 1.0 },
    { id: 'flykhiva', name: 'FlyKhiva', site: 'https://b2b.flykhiva.travel/search_tour', sys: 'samo', color: '#C2410C', f: 0.985 },
    { id: 'easybooking', name: 'Easybooking', site: 'https://tours.easybooking.uz/search_tour', sys: 'samo', color: '#16A34A', f: 1.01 },
    { id: 'malva', name: 'Malva Tour', site: 'https://malvatouroperator.uz/search_tour', sys: 'samo', color: '#BE185D', f: 1.02 },
    { id: 'vietratour', name: 'Vietratour', site: 'https://b2b.vietratour.com/', sys: 'samo', countries: ['vn'], color: '#DA251D', f: 0.97 },
    { id: 'selfie', name: 'Selfie Travel', site: 'http://b2b.selfietravel.kz/search_tour', sys: 'samo', color: '#DB2777', f: 1.005 },
    { id: 'savtour', name: 'Savtour', site: 'https://online.savtour.az/search_tour', sys: 'samo', countries: ['az', 'ge', 'tr'], color: '#0369A1', f: 0.99 },
    { id: 'vek', name: 'Velikolepniy Vek', site: 'https://velikolepniy-vek.com/login', sys: 'own', countries: ['tr'], color: '#7F1D1D', f: 1.03 },
    { id: 'mirjahon', name: 'Mir-Jahon', site: 'https://online.mir-jahon.uz', sys: 'own', color: '#4D7C0F', f: 1.035 },
    { id: 'rezlive', name: 'RezLive', site: 'https://www.rezlive.com', sys: 'api', hotelOnly: true, color: '#1D4ED8', f: 0.96 }
  ].map(o => Object.assign({ live: false }, o));

  // ---------- Davlatlar ----------
  // flight — bir kishilik aviareys (USD), k — mehmonxona narxi koeffitsienti
  // 2026-11-23 da operatorlarning ochiq qidiruvidagi bugungi narxlarga moslashtirilgan
  // (Toshkentdan, 7 tun, 2 kishi, eng arzon tur: demo'dagi eng arzon 3* tur ≈ bugungi eng arzon tur)
  const COUNTRIES = [
    { id: 'tr', region: 'kavkaz', flight: 260, k: 1.0, tint: '#1E5A8A', cities: ['antalya', 'alanya', 'kemer', 'side', 'belek'] },
    { id: 'ge', region: 'kavkaz', flight: 225, k: 0.8, tint: '#2F6B3A', cities: ['batumi', 'tbilisi'] },
    { id: 'az', region: 'kavkaz', flight: 170, k: 0.6, tint: '#3B4F8F', cities: ['baku', 'naftalan', 'gabala'] },
    { id: 'ae', region: 'sharq', flight: 195, k: 1.05, tint: '#7A5410', cities: ['dubai', 'sharjah', 'rak'] },
    { id: 'eg', region: 'sharq', flight: 315, k: 0.9, tint: '#8A3B12', cities: ['sharm', 'hurghada'] },
    { id: 'my', region: 'osiyo', flight: 420, k: 0.9, tint: '#14636B', cities: ['kl', 'langkawi'] },
    { id: 'th', region: 'osiyo', flight: 525, k: 0.95, tint: '#6B3A82', cities: ['phuket', 'pattaya'] },
    { id: 'vn', region: 'osiyo', flight: 600, k: 0.8, tint: '#8A2E3B', cities: ['nhatrang', 'phuquoc'] },
    { id: 'id', region: 'osiyo', flight: 850, k: 1.45, tint: '#2E6B4F', cities: ['kuta', 'ubud', 'nusadua'] },
    { id: 'lk', region: 'osiyo', flight: 350, k: 0.6, tint: '#93450F', cities: ['bentota', 'hikkaduwa'] },
    { id: 'mv', region: 'osiyo', flight: 650, k: 2.0, tint: '#0E6E8C', cities: ['male', 'ari'] }
  ];
  const REGIONS = ['kavkaz', 'sharq', 'osiyo'];

  // ---------- Mehmonxonalar (demo) ----------
  // [id, nomi, davlat, shahar, yulduz, reyting]
  const RAW_HOTELS = [
    ['tr1', 'Lara Sunset Resort', 'tr', 'antalya', 5, 9.1],
    ['tr2', 'Antaliya City Inn', 'tr', 'antalya', 3, 7.9],
    ['tr3', 'Konyaalti Beach Hotel', 'tr', 'antalya', 4, 8.3],
    ['tr4', 'Alanya Blue Coast', 'tr', 'alanya', 4, 8.4],
    ['tr5', 'Alanya Sun Club', 'tr', 'alanya', 3, 7.6],
    ['tr6', 'Alanya Family Club', 'tr', 'alanya', 4, 8.0],
    ['tr7', 'Kemer Pine Hotel', 'tr', 'kemer', 4, 8.6],
    ['tr8', 'Kemer Marina Suites', 'tr', 'kemer', 5, 8.9],
    ['tr9', 'Side Olive Garden', 'tr', 'side', 5, 9.0],
    ['tr10', 'Side Aqua Park Hotel', 'tr', 'side', 4, 8.2],
    ['tr11', 'Belek Royal Palace', 'tr', 'belek', 5, 9.3],
    ['tr12', 'Belek Golf Resort', 'tr', 'belek', 5, 8.8],
    ['ae1', 'Dubai Creek View', 'ae', 'dubai', 4, 8.5],
    ['ae2', 'Marina Pearl Hotel', 'ae', 'dubai', 5, 9.0],
    ['ae3', 'Deira Business Hotel', 'ae', 'dubai', 3, 7.8],
    ['ae4', 'Al Barsha Sands Hotel', 'ae', 'dubai', 4, 8.3],
    ['ae5', 'Sharja Corniche Inn', 'ae', 'sharjah', 3, 7.7],
    ['ae6', 'Al Majaz Lake Hotel', 'ae', 'sharjah', 4, 8.1],
    ['ae7', 'RAK Beach Resort', 'ae', 'rak', 5, 8.9],
    ['ae8', 'Al Marjan Island Hotel', 'ae', 'rak', 4, 8.4],
    ['eg1', 'Red Sea Coral Resort', 'eg', 'sharm', 5, 8.8],
    ['eg2', 'Naama Bay Hotel', 'eg', 'sharm', 4, 8.2],
    ['eg3', 'Sharm Garden Inn', 'eg', 'sharm', 3, 7.6],
    ['eg4', 'Hurghada Palm Beach', 'eg', 'hurghada', 4, 8.3],
    ['eg5', 'Sahl Hasheesh Resort', 'eg', 'hurghada', 5, 9.0],
    ['eg6', 'Makadi Garden Hotel', 'eg', 'hurghada', 3, 7.8],
    ['ge1', 'Batumi Sea Tower', 'ge', 'batumi', 4, 8.6],
    ['ge2', 'Batumi Boulevard Inn', 'ge', 'batumi', 3, 8.0],
    ['ge3', 'Black Sea Grand Hotel', 'ge', 'batumi', 5, 9.0],
    ['ge4', 'Old Tbilisi Boutique', 'ge', 'tbilisi', 4, 8.9],
    ['ge5', 'Tbilisi Riverside Hotel', 'ge', 'tbilisi', 3, 7.9],
    ['az1', 'Caspian Boulevard Hotel', 'az', 'baku', 4, 8.5],
    ['az2', 'Baku Old City Inn', 'az', 'baku', 3, 8.1],
    ['az3', 'Baku Skyline Hotel', 'az', 'baku', 5, 9.0],
    ['az4', 'Naftalan Health Resort', 'az', 'naftalan', 4, 8.4],
    ['az5', 'Gabala Mountain Lodge', 'az', 'gabala', 4, 8.7],
    ['my1', 'KL Twin View Hotel', 'my', 'kl', 4, 8.6],
    ['my2', 'Bukit Bintang Suites', 'my', 'kl', 3, 8.0],
    ['my3', 'Langkawi Cenang Resort', 'my', 'langkawi', 4, 8.5],
    ['my4', 'Langkawi Rainforest Resort', 'my', 'langkawi', 5, 9.1],
    ['th1', 'Patong Bay Hotel', 'th', 'phuket', 4, 8.4],
    ['th2', 'Kata Palm Resort', 'th', 'phuket', 5, 8.9],
    ['th3', 'Pattaya Beach Inn', 'th', 'pattaya', 3, 7.7],
    ['th4', 'Jomtien Garden Hotel', 'th', 'pattaya', 4, 8.2],
    ['vn1', 'Nha Trang Bay Hotel', 'vn', 'nhatrang', 4, 8.3],
    ['vn2', 'Tran Phu Inn', 'vn', 'nhatrang', 3, 7.8],
    ['vn3', 'Phu Quoc Pearl Resort', 'vn', 'phuquoc', 5, 9.0],
    ['id1', 'Kuta Surf Hotel', 'id', 'kuta', 3, 7.9],
    ['id2', 'Ubud Jungle Villas', 'id', 'ubud', 4, 9.0],
    ['id3', 'Nusa Dua Lagoon Resort', 'id', 'nusadua', 5, 9.1],
    ['lk1', 'Bentota Beach Resort', 'lk', 'bentota', 4, 8.4],
    ['lk2', 'Golden Sands Bentota', 'lk', 'bentota', 5, 8.8],
    ['lk3', 'Hikkaduwa Coral Inn', 'lk', 'hikkaduwa', 3, 7.8],
    ['mv1', 'Maafushi Beach Hotel', 'mv', 'male', 3, 8.2],
    ['mv2', 'Blue Reef Island', 'mv', 'male', 4, 8.7],
    ['mv3', 'Coral Lagoon Island Resort', 'mv', 'ari', 5, 9.3]
  ];
  const HOTELS = RAW_HOTELS.map(a => ({ id: a[0], name: a[1], country: a[2], city: a[3], stars: a[4], rating: a[5] }));
  const HOTEL_BY_ID = {};
  HOTELS.forEach(h => { HOTEL_BY_ID[h.id] = h; });

  // ---------- Uchish shaharlari: add — aviareysga qo'shimcha (USD), reach — shu shahardan uchadigan operatorlar ulushi ----------
  // Ro'yxat server/live/samo.js (FROM_RU) va server/live/validation.js (FROM_IDS) bilan bir xil
  const FROM = [
    { id: 'tas', add: 0, code: 'TAS', reach: 1 },
    { id: 'skd', add: 35, code: 'SKD', reach: 0.7 },
    { id: 'bhk', add: 45, code: 'BHK', reach: 0.45 },
    { id: 'ugc', add: 55, code: 'UGC', reach: 0.4 },
    { id: 'nma', add: 50, code: 'NMA', reach: 0.4 },
    { id: 'feg', add: 50, code: 'FEG', reach: 0.4 },
    { id: 'azn', add: 50, code: 'AZN', reach: 0.35 },
    { id: 'tmj', add: 60, code: 'TMJ', reach: 0.3 },
    { id: 'nvi', add: 55, code: 'NVI', reach: 0.3 },
    { id: 'ksq', add: 55, code: 'KSQ', reach: 0.3 },
    { id: 'ncu', add: 65, code: 'NCU', reach: 0.3 },
    { id: 'dyu', add: 55, code: 'DYU', reach: 0.5 }
  ];
  const HOME_TZ = 5; // Toshkent / Samarqand / Dushanbe: UTC+5

  // ---------- Aviachiptalar (demo) ----------
  // Aviakompaniyalar o'ylab topilgan. f — narx koeffitsienti, low — arzon (bagajsiz tariflar ko'p)
  const AIRLINES = [
    { id: 'silkair', code: 'SX', name: 'Silk Air', color: '#0284C7', f: 1.0 },
    { id: 'turan', code: 'TW', name: 'Turan Wings', color: '#B45309', f: 0.97 },
    { id: 'pamir', code: 'PJ', name: 'Pamir Jet', color: '#15803D', f: 0.9, low: true },
    { id: 'caspian', code: 'KW', name: 'Caspian Wings', color: '#7C3AED', f: 1.04 },
    { id: 'aral', code: 'AV', name: 'Aral Avia', color: '#BE123C', f: 1.08 }
  ];
  // Har bir davlatning asosiy aeroporti: hrs — Toshkentdan to'g'ri reys davomiyligi, tz — UTC farqi
  const AIRPORTS = {
    tr: { code: 'AYT', city: 'antalya', hrs: 5.0, tz: 3 },
    ge: { code: 'TBS', city: 'tbilisi', hrs: 3.0, tz: 4 },
    az: { code: 'GYD', city: 'baku', hrs: 2.6, tz: 4 },
    ae: { code: 'DXB', city: 'dubai', hrs: 3.3, tz: 4 },
    eg: { code: 'SSH', city: 'sharm', hrs: 5.5, tz: 2 },
    my: { code: 'KUL', city: 'kl', hrs: 6.5, tz: 8 },
    th: { code: 'HKT', city: 'phuket', hrs: 7.0, tz: 7 },
    vn: { code: 'CXR', city: 'nhatrang', hrs: 7.5, tz: 7 },
    id: { code: 'DPS', city: 'denpasar', hrs: 9.5, tz: 8 },
    lk: { code: 'CMB', city: 'colombo', hrs: 5.5, tz: 5.5 },
    mv: { code: 'MLE', city: 'malecity', hrs: 5.0, tz: 5 }
  };
  const HUBS = ['IST', 'DXB', 'GYD', 'KUL', 'DOH'];

  // RO va FB — faqat operatorlarning haqiqiy takliflarida uchraydi
  const MEALS = { RO: { f: 0.9 }, BB: { f: 1 }, HB: { f: 1.15 }, FB: { f: 1.25 }, AI: { f: 1.32 }, UAI: { f: 1.45 } };
  const ROOMS = [{ id: 'std', f: 1 }, { id: 'sup', f: 1.07 }, { id: 'dlx', f: 1.15 }];

  const byId = {};
  COUNTRIES.forEach(c => { byId[c.id] = c; });

  const UZS_RATE = 12004.48; // Markaziy bank kursi 21.11.2026: 1 USD = 12 004,48 so'm (keyinchalik CBU API'dan avtomatik olinadi)

  // ---------- Yordamchilar ----------
  // Demo narxlar har safar bir xil chiqishi uchun "urug'li" tasodifiy son
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rnd(str) {
    let t = (hash(str) + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const date = {
    parse(iso) { const p = String(iso).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); },
    iso(d) { return d.toISOString().slice(0, 10); },
    localToday() { const n = new Date(); return date.iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); },
    addDays(iso, n) { const d = date.parse(iso); d.setUTCDate(d.getUTCDate() + n); return date.iso(d); },
    isValid(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && !isNaN(date.parse(iso)); }
  };

  // ---------- Real vaqtdagi mavjudlik ----------
  // Demo: takliflarning bir qismi kun davomida tasodifiy paytda sotilib ketadi (vaqt o'tishi bilan ro'yxatdan yo'qoladi).
  // Haqiqiy versiyada bu yerda operator API'sidan joylar soni muntazam so'raladi.
  // Bron qilingan takliflar (booked) ham qidiruvdan olib tashlanadi.
  let now = () => Date.now();
  const booked = {};
  let goneVer = 0;  // bron ro'yxati o'zgarganda keshni yangilash uchun
  function soldOut(key) {
    if (rnd(key + 'so') >= 0.12) return false;
    const n = new Date(now());
    const dayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return now() >= dayStart + rnd(key + 'sot') * 86400000;
  }
  // Jonli (haqiqiy) takliflar kalitlari: ularga demo "sotilib ketdi" simulyatsiyasi qo'llanmaydi —
  // aks holda haqiqiy takliflarning ~12 % i tasodifan yashirilib qolardi. Faqat haqiqiy bronlar hisobga olinadi.
  const liveKeys = new Set();
  // Shakl bo'yicha ham: mehmonxona 'L<hash>|...', reys 'F|aviakompaniya|<operator>.<reys>|...' (sahifa yangilanganda saqlangan takliflar uchun)
  const isLiveKey = (key) => liveKeys.has(key) || /^L[0-9a-z]+\|/.test(key) || /^F\|[^|]+\|[a-z]+\.[^|]+\|/.test(key);
  const isGone = (key) => !!booked[key] || (!isLiveKey(key) && soldOut(key));
  function setBooked(keys) {
    Object.keys(booked).forEach(k => { delete booked[k]; });
    keys.forEach(k => { booked[k] = true; });
    goneVer++;
  }

  // Bolalar narxi yoshiga qarab: 2 yoshgacha — mehmonxona bepul, reysning 10 %;
  // 2–11 yosh — mehmonxonaning 50 %, reysning 75 %; 12+ — katta kishi kabi.
  const childHotelF = (age) => (age < 2 ? 0 : age < 12 ? 0.5 : 1);
  const childFlightF = (age) => (age < 2 ? 0.1 : age < 12 ? 0.75 : 1);

  // ---------- Demo: paket ichidagi reys (uchish vaqti, reys raqami, chipta narxi) ----------
  // Charter — operatorning blok reysi; GDS — oddiy muntazam reys (chipta GDS orqali, narxi alohida ko'rinadi)
  function demoTicket(country, from, o, dateIso, nights, gds, price) {
    const ap = AIRPORTS[country];
    if (!ap) return null;
    const seed = country + from.id + o.id + (gds ? 'g' : 'c');
    const al = AIRLINES[Math.floor(rnd(seed + 'al') * AIRLINES.length)];
    const dur = Math.round(ap.hrs * 60 / 5) * 5 + (gds && rnd(seed + 'tr') < 0.5 ? 5 * Math.round((90 + rnd(seed + 'tw') * 150) / 5) : 0);
    const dep = 5 * Math.floor(rnd(seed + dateIso + 'd') * 288);
    const arr = (((dep + dur + Math.round((ap.tz - HOME_TZ) * 60)) % 1440) + 1440) % 1440;
    const bdep = 5 * Math.floor(rnd(seed + date.addDays(dateIso, nights) + 'b') * 288);
    const barr = (((bdep + dur + Math.round((HOME_TZ - ap.tz) * 60)) % 1440) + 1440) % 1440;
    const num = 100 + Math.floor(rnd(seed + 'no') * 800) * 2;
    return {
      price, airline: al.name, no: al.code + ' ' + num, dep, arr, dur, fromCode: from.code, toCode: ap.code,
      back: { no: al.code + ' ' + (num + 1), dep: bdep, arr: barr }
    };
  }

  // ---------- Bitta mehmonxona uchun barcha operatorlarning takliflari ----------
  // q = { from, nights, adults, childAges: [yosh, ...], rooms }
  function offersFor(h, q, dateIso) {
    const c = byId[h.country];
    const from = FROM.find(x => x.id === q.from) || FROM[0];
    const ages = q.childAges || [];
    const rooms = q.rooms || 1;
    const base = ({ 3: 38, 4: 62, 5: 105 })[h.stars] * (0.9 + 0.3 * rnd(h.id + 'b')) * c.k;
    const mealOpts = h.stars === 5 ? ['AI', 'UAI'] : h.stars === 4 ? ['HB', 'AI'] : ['BB', 'HB'];
    const dow = date.parse(dateIso).getUTCDay();
    const dateF = (dow === 5 || dow === 6 ? 1.06 : 1) * (0.95 + 0.1 * rnd(dateIso + c.id));
    // Shu yo'nalishda ishlaydigan operatorlar; har bir mehmonxonani ulardan ~4–6 tasi sotadi.
    // Viloyat shaharlaridan (Samarqand, Buxoro, ...) charter kamroq — u yerdan faqat ayrim operatorlar uchadi
    const serve = OPS.filter(o => (!o.countries || o.countries.indexOf(h.country) >= 0) && (q.noFlight || !o.hotelOnly) &&
      (q.noFlight || from.reach >= 1 || rnd(o.id + from.id + h.country) < from.reach));
    let ops = serve.filter(o => rnd(h.id + o.id) < (o.countries ? 0.8 : 0.27));
    if (ops.length < 3) ops = serve.slice().sort((a, b) => rnd(h.id + a.id + 's') - rnd(h.id + b.id + 's')).slice(0, 3);
    const pax = q.adults + ages.reduce((s, a) => s + childHotelF(a), 0);
    const fpax = q.adults + ages.reduce((s, a) => s + childFlightF(a), 0);
    const roomsF = 1 + 0.12 * (rooms - 1);
    return ops.map(o => {
      const meal = mealOpts[rnd(h.id + o.id + 'm') < 0.5 ? 0 : 1];
      const room = ROOMS[Math.min(2, Math.floor(rnd(h.id + o.id + 'r') * 2.4))];
      const of = o.f * (0.95 + 0.1 * rnd(h.id + o.id + dateIso));
      const hotelPart = base * q.nights * pax * MEALS[meal].f * room.f * roomsF;
      // Paket = mehmonxona + aviachipta. GDS paket — oddiy (muntazam) reys, chipta GDS orqali: narxi biroz yuqori
      const gds = !q.noFlight && rnd(h.id + o.id + 'g') < 0.3;
      // q.noFlight — faqat mehmonxona (Mehmonxonalar bo'limi): mehmonxona tur paket ichidan olinadi (paket − chipta)
      const flight = q.noFlight ? 0 : (c.flight + from.add) * fpax * (gds ? 1.12 : 1);
      const k = dateF * of;
      const price = Math.round((hotelPart + flight) * k / 5) * 5;
      const ra = rnd(h.id + o.id + dateIso + 'a');
      const avail = ra < 0.62 ? 'ok' : ra < 0.82 ? 'few' : ra < 0.94 ? 'req' : 'stop';
      const rf = rnd(h.id + o.id + dateIso + 'f');
      const seats = rf < 0.75 ? 'ok' : rf < 0.93 ? 'few' : 'none';
      const instant = rnd(h.id + o.id + 'i') < 0.55;
      const key = [h.id, o.id, dateIso, q.nights, q.adults, ages.join('.'), rooms, q.noFlight ? 'H' : q.from].join('|');
      const offer = { key, op: o, meal, room: room.id, price, avail, seats, instant, gds };
      // Mehmonxonalar bo'limi: tur operatorlarning mehmonxonasi — tur paket ichidan; RezLive kabi faqat mehmonxona sotuvchilar — o'zi
      if (q.noFlight) { if (!o.hotelOnly) offer.fromTour = true; }
      else {
        const tp = Math.round(flight * k / 5) * 5;
        offer.ticket = demoTicket(h.country, from, o, dateIso, q.nights, gds, tp);
        offer.hotelPrice = price - tp;
      }
      return offer;
    // Sotilganlar umuman qaytarilmaydi: sotuvi to'xtagan, reysda joy qolmagan (tur uchun), sotilib ketgan yoki bron qilingan
    }).filter(o => o.avail !== 'stop' && (q.noFlight || o.seats !== 'none') && !isGone(o.key));
  }

  // ---------- Mehmonxona tafsilotlari (demo) ----------
  // Mehmonxonalar o'ylab topilgan, shuning uchun tafsilotlar ham "urug'li" tasodifiy — har safar bir xil chiqadi.
  // Haqiqiy versiyada bu ma'lumotlar operator / mehmonxona bazasidan (GIATA, operator kontenti) olinadi.
  // Jonli (haqiqiy) mehmonxonalar uchun null — o'ylab topilgan tafsilot ko'rsatilmaydi.
  const NO_BEACH = ['tbilisi', 'naftalan', 'gabala', 'kl', 'ubud'];        // dengiz yo'q
  const CITY_SEA = ['baku', 'dubai', 'sharjah', 'pattaya', 'kuta', 'male']; // shahar, dengiz yaqin
  const hotelInfoCache = {};
  function hotelInfo(h) {
    if (!h || h.live) return null;
    if (hotelInfoCache[h.id]) return hotelInfoCache[h.id];
    const r = (s) => rnd(h.id + 'i' + s);
    const resort = NO_BEACH.indexOf(h.city) < 0 && CITY_SEA.indexOf(h.city) < 0;
    const beach = NO_BEACH.indexOf(h.city) >= 0 ? null
      : resort ? (r('b') < 0.45 ? 0 : 10 * Math.round((50 + r('bd') * (h.stars === 5 ? 250 : 650)) / 10))
        : 50 * Math.round((300 + r('bd') * 1700) / 50);
    const f = ['wifi', 'restaurant'];
    const add = (id, p) => { if (r(id) < p) f.push(id); };
    if (h.stars === 5) { f.push('pool', 'spa', 'gym', 'ala_carte', 'bar'); add('ipool', 0.7); add('kids', 0.8); add('anim', resort ? 0.85 : 0.3); add('aqua', resort ? 0.5 : 0.1); add('tennis', 0.5); }
    else if (h.stars === 4) { f.push('bar'); add('pool', 0.9); add('spa', 0.55); add('gym', 0.6); add('kids', 0.55); add('anim', resort ? 0.6 : 0.15); add('aqua', resort ? 0.25 : 0); }
    else { add('pool', resort ? 0.7 : 0.3); add('bar', 0.6); }
    if (beach != null && beach <= 150 && (resort || r('pb') < 0.3)) f.push('beach');
    add('parking', 0.7); add('conf', h.stars >= 4 && !resort ? 0.7 : 0.15);
    const size = (base) => Math.round(base * (h.stars === 5 ? 1.35 : h.stars === 4 ? 1.1 : 0.9) * (0.9 + 0.2 * r('s' + base)));
    const built = 1990 + Math.floor(r('y') * 30);
    const info = {
      resort, beach, firstLine: beach != null && beach <= 100 && resort,
      beachType: beach == null ? null : ['sand', 'sand', 'pebble', 'mixed'][Math.floor(r('bt') * 4)],
      airport: Math.round(8 + r('a') * (resort ? 55 : 25)),
      center: resort ? Math.round(1 + r('c') * 14) : Math.round(r('c') * 50) / 10 + 0.3,
      built, renovated: Math.min(2026, built + 4 + Math.floor(r('ry') * (2025 - built))),
      rooms: Math.round((h.stars === 5 ? 220 : h.stars === 4 ? 140 : 60) * (0.6 + r('n') * 0.9)),
      facilities: f,
      roomSizes: { std: size(22), sup: size(28), dlx: size(36) },
      checkIn: '14:00', checkOut: '12:00'
    };
    hotelInfoCache[h.id] = info;
    return info;
  }

  // ---------- Qaynoq taklif: keyingi 3 hafta ichidagi eng arzon tur (2 katta, 7 tun) ----------
  const hotCache = {};
  let hotStamp = '';
  function hotFor(countryId, from, today, noFlight) {
    // Kesh har daqiqada va har bron qilinganda tozalanadi (sotilganlar qaynoq takliflarda qolmasin)
    const stamp = Math.floor(now() / 60000) + '|' + goneVer;
    if (stamp !== hotStamp) { hotStamp = stamp; Object.keys(hotCache).forEach(k => { delete hotCache[k]; }); }
    const key = countryId + '|' + from + '|' + today + '|' + (noFlight ? 'H' : 'T');
    if (hotCache[key] !== undefined) return hotCache[key];
    const q = { from, adults: 2, childAges: [], rooms: 1, nights: 7, noFlight: !!noFlight };
    const hs = HOTELS.filter(h => h.country === countryId);
    let best = null;
    for (let i = 3; i <= 24; i++) {
      const d = date.addDays(today, i);
      hs.forEach(h => offersFor(h, q, d).forEach(o => {
        if ((o.avail === 'ok' || o.avail === 'few') && (!best || o.price < best.price)) {
          best = { price: o.price, date: d, hotelId: h.id };
        }
      }));
    }
    hotCache[key] = best;
    return best;
  }

  // ---------- Aviareyslar ----------
  // Bitta yo'nalish (leg): dep/arr — mahalliy vaqt (daqiqa, 0..1439), days — kelish necha kun keyin, dur — davomiylik (daqiqa)
  function legFor(seed, dateIso, hrs, tzDiff, direct, avoid) {
    const dep = 5 * Math.floor(rnd(seed + 'd') * 287);
    let dur = Math.round(hrs * 60 * (0.95 + 0.1 * rnd(seed + 'u')) / 5) * 5;
    let via = null;
    if (!direct) {
      dur += 5 * Math.round((80 + rnd(seed + 'w') * 200) / 5);
      const hubs = HUBS.filter(x => avoid.indexOf(x) < 0);
      via = hubs[Math.floor(rnd(seed + 'v') * hubs.length)];
    }
    const arrAbs = dep + dur + Math.round(tzDiff * 60);
    return { date: dateIso, dep, arr: ((arrAbs % 1440) + 1440) % 1440, days: Math.floor(arrAbs / 1440), dur, via };
  }

  // q = { from, to (davlat id), ret (qaytish sanasi yoki null), adults, childAges, cabin: 'eco'|'bus' }
  // Narx — barcha yo'lovchilar uchun jami (borish yoki borish-qaytish)
  function flightsFor(q, dateIso) {
    const c = byId[q.to], ap = AIRPORTS[q.to];
    const from = FROM.find(x => x.id === q.from) || FROM[0];
    const ages = q.childAges || [];
    const fpax = q.adults + ages.reduce((s, a) => s + childFlightF(a), 0);
    const route = from.id + '-' + q.to;
    const dow = date.parse(dateIso).getUTCDay();
    const dateF = (dow === 5 || dow === 6 ? 1.07 : 1) * (0.92 + 0.16 * rnd(dateIso + route));
    const out = [];
    AIRLINES.forEach(al => {
      if (rnd(route + al.id) > 0.78) return;                    // bu yo'nalishda uchmaydi
      if (rnd(route + al.id + dateIso) > 0.85) return;          // shu kuni reys yo'q
      const n = rnd(route + al.id + 'n') < 0.35 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const seed = route + al.id + i;
        const direct = rnd(seed + 'x') < (ap.hrs > 7 ? 0.25 : 0.62);
        const avoid = [ap.code, from.code];
        const leg = legFor(seed, dateIso, ap.hrs, ap.tz - HOME_TZ, direct, avoid);
        const back = q.ret ? legFor(seed + 'r', q.ret, ap.hrs * 0.95, HOME_TZ - ap.tz, direct, avoid) : null;
        const hand = q.cabin === 'eco' && rnd(seed + 'b') < (al.low ? 0.7 : 0.25);
        const bag = q.cabin === 'bus' ? 'b2x32' : hand ? 'hand' : (rnd(seed + 'g') < 0.5 ? 'b20' : 'b23');
        let pp = (c.flight + from.add) * 0.62 * al.f * dateF * (direct ? 1.12 : 0.9) * (hand ? 0.85 : 1) * (0.95 + 0.1 * rnd(seed + dateIso + 'p'));
        if (q.ret) pp *= 1.8 * (0.95 + 0.1 * rnd(seed + q.ret + 'p'));
        if (q.cabin === 'bus') pp *= 2.7;
        const rs = rnd(seed + dateIso + 's');
        if (rs > 0.93) continue;                                // joy qolmagan — ko'rsatilmaydi
        const key = ['F', al.id, i, from.id, q.to, dateIso, q.ret || '', q.adults, ages.join('.'), q.cabin].join('|');
        if (isGone(key)) continue;                              // sotilib ketgan yoki bron qilingan
        const num = 100 + Math.floor(rnd(seed + 'no') * 800) * 2;
        out.push({
          key,
          al, to: q.to, no: al.code + ' ' + num, backNo: al.code + ' ' + (num + 1),
          fromCode: from.code, toCode: ap.code, out: leg, back, direct, bag,
          price: Math.round(pp * fpax / 5) * 5, seats: rs < 0.68 ? 'ok' : 'few'
        });
      }
    });
    return out;
  }

  // ---------- Jonli (haqiqiy) takliflar: operatorlardan server orqali (server/live) ----------
  // Har bir qidiruv (davlat + sana + tunlar + mehmonlar + jo'nash) uchun alohida to'plam.
  // Bir xil mehmonxona turli operatorlarda bo'lsa — bitta kartaga birlashadi (nomi + shahar bo'yicha).
  const OP_BY_ID = {};
  OPS.forEach(o => { OP_BY_ID[o.id] = o; });
  const live = {};                 // sig -> { at, country, hotelIds: [], offers: { hotelId: [offer] }, ops: [...] }
  const LIVE_KEY = 'tezbooking.liveHotels';
  // Oxirgi qism: jo'nash shahri (tur) yoki 'H' (faqat mehmonxona — reyssiz)
  const tailOf = (q) => (q.noFlight ? 'H' : q.from);
  // Mehmonxona bo'yicha qidiruv (q.hotel) alohida kesh: umumiy natija bilan aralashmasin
  // Shahar (kurort) — faqat o'z davlati natijasi uchun alohida kesh (js/cities.js)
  const cityCountry = (id) => { const c = id && window.TB_CITIES ? window.TB_CITIES.byId(id) : null; return c ? c.country : ''; };
  const liveSig = (country, q, dateIso) => [country, dateIso, q.nights, q.adults, (q.childAges || []).join('.'), tailOf(q)].join('|')
    + (q.hotel ? '|h:' + String(q.hotel).toLowerCase().replace(/\s+/g, ' ').trim() : '')
    + (q.city && cityCountry(q.city) === country ? '|c:' + q.city : '');
  const slug = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
  // Diqqat: nomi hash() emas — aks holda yuqoridagi hash() ni almashtirib, rnd() doim 0 qaytaradi (barcha demo takliflar yashirinadi)
  const hash36 = (s) => hash(String(s)).toString(36);
  // Avval ko'rilgan haqiqiy mehmonxonalar (mijozga taklifda qolganlari sahifa yangilanganda ham ochilsin)
  try { (JSON.parse(localStorage.getItem(LIVE_KEY) || '[]') || []).forEach(h => { if (h && h.id) HOTEL_BY_ID[h.id] = h; }); } catch (e) { /* yo'q */ }
  function saveLiveHotels() {
    try {
      const list = Object.keys(HOTEL_BY_ID).filter(id => HOTEL_BY_ID[id].live).slice(-400).map(id => HOTEL_BY_ID[id]);
      localStorage.setItem(LIVE_KEY, JSON.stringify(list));
    } catch (e) { /* to'lgan */ }
  }
  // merge: "Operatordan yana yuklash" — mavjud natijaga keyingi sahifalar qo'shiladi, operator holati (more/next) yangilanadi.
  // data.partial: qo'shni kun (±3 kun so'rovidan, faqat eng arzonlari) — shu kun tanlanganda to'liq qayta so'raladi.
  function setLive(country, q, dateIso, data, merge) {
    const sig = liveSig(country, q, dateIso);
    const old = merge && live[sig];
    // srvAt — operatorlardan olingan vaqt (server javobidagi at): "HH:MM da yangilandi" va 5 daqiqalik yangilash shundan hisoblanadi
    const entry = old || { at: Date.now(), srvAt: data.at || Date.now(), country, hotelIds: [], offers: {}, ops: data.operators || [], partial: !!data.partial };
    // Qo'shilayotgan operator holati yangilanadi (yana yuklash: more/next; xato bergan operator qayta so'ralganda: status ham)
    if (old) (data.operators || []).forEach(x => { const i = old.ops.findIndex(o => o.id === x.id); if (i >= 0) old.ops[i] = Object.assign({}, old.ops[i], x, { more: x.more, next: x.next }); });
    (data.offers || []).forEach(r => {
      if (!OP_BY_ID[r.opId] || !r.hotel || !(r.price > 0)) return;
      const hid = 'L' + hash36(country + '|' + slug(r.hotel) + '|' + slug(r.city));
      if (!HOTEL_BY_ID[hid]) HOTEL_BY_ID[hid] = { id: hid, name: r.hotel, country, city: r.city || '', stars: r.stars || 0, rating: 0, live: true };
      else if (r.stars && !HOTEL_BY_ID[hid].stars) HOTEL_BY_ID[hid].stars = r.stars;
      const list = entry.offers[hid] || (entry.offers[hid] = []);
      if (!list.length) entry.hotelIds.push(hid);
      // Kalit formati demo bilan bir xil: mehmonxona|operator|sana|tunlar|kattalar|bolalar|xonalar|jo'nash
      // Tur dasturi va reys ham kalitda: operator saytidagidek bir xil xona/ovqat, lekin boshqa tur (GDS/charter, Promo, boshqa reys) —
      // alohida paket (oldin eng arzoniga qo'shilib ketardi)
      const key = [hid, r.opId + '.' + (r.roomKey || hash36(r.room)) + '.' + (r.mealKey || r.meal) + '.' + hash36((r.tour || '') + '/' + (r.dep == null ? '' : r.dep)), dateIso, q.nights, q.adults, (q.childAges || []).join('.'), 1, tailOf(q)].join('|');
      liveKeys.add(key);
      const prev = list.find(o => o.key === key);
      if (prev && prev.price <= r.price) return;
      const offer = { key, op: OP_BY_ID[r.opId], meal: r.meal, mealRaw: r.mealRaw, room: r.room || 'std', price: r.price,
        avail: r.avail === 'ok' || r.avail === 'few' ? r.avail : 'req', seats: r.seats === 'none' ? 'few' : r.seats, instant: r.avail === 'ok', tour: r.tour, live: true,
        // Paket tarkibi (server/live): reys va chipta narxi, mehmonxona ≈ paket − chipta; GDS paket; tur paket ichidan olingan mehmonxona
        gds: !!r.gds, fromTour: !!r.fromTour, withFlight: !!r.withFlight,
        // Uchish vaqti tur qatorining o'zidan (operator javobi); sana — reys sanasi (tunda uchsa kirish kunidan farq qilishi mumkin)
        dep: typeof r.dep === 'number' ? r.dep : null, depDate: r.depDate || null, fromCode: r.fromCode || '', toCode: r.toCode || '',
        ticket: r.ticket && r.ticket.price > 0 ? r.ticket : null,
        hotelPrice: r.hotelPrice > 0 ? Math.round(r.hotelPrice) : null,
        packagePrice: r.packagePrice > 0 ? r.packagePrice : null,
        // Operator narxi boshqa valyutada (EUR): price — operatorning o'zi o'girgan USD narxi
        opPrice: r.opPrice > 0 ? r.opPrice : null, opCurrency: r.opCurrency || '' };
      if (prev) list[list.indexOf(prev)] = offer; else list.push(offer);
    });
    if (old) old.at = Date.now();
    live[sig] = entry;
    goneVer++;
    saveLiveHotels();
    return entry;
  }
  const liveEntry = (country, q, dateIso) => live[liveSig(country, q, dateIso)] || null;
  function liveOffersFor(h, q, dateIso) {
    const e = live[liveSig(h.country, q, dateIso)];
    return e && e.offers[h.id] ? e.offers[h.id].filter(o => !isGone(o.key)) : [];
  }
  const liveHotels = (countries, q, dateIso) => [].concat(...countries.map(c => {
    const e = liveEntry(c, q, dateIso);
    return e ? e.hotelIds.map(id => HOTEL_BY_ID[id]) : [];
  }));

  // ---------- Jonli aviachiptalar (operatorlarning charter/blok reyslari) ----------
  // Har bir reys flightsFor() bilan bir xil ko'rinishda: sayt ikkalasini bir xil chizadi.
  const liveF = {};                // sig -> { at, ops, flights }
  const LIVE_AL = {};              // aviakompaniya nomi -> { id, name, code, color }
  const AL_COLORS = ['#0057D8', '#009C9F', '#FF9600', '#7C3AED', '#DB2777', '#16A34A', '#B45309', '#0369A1'];
  const liveFSig = (q, dateIso) => ['F', q.to, dateIso, q.ret || '', q.adults, (q.childAges || []).join('.'), q.cabin, q.from].join('|');
  function airlineOf(name) {
    const id = 'L' + slug(name || 'x');
    if (!LIVE_AL[id]) {
      const known = AIRLINES.find(a => slug(a.name) === slug(name));
      LIVE_AL[id] = known || { id, name: name || '—', code: '', color: AL_COLORS[parseInt(hash36(name || 'x'), 36) % AL_COLORS.length] };
    }
    return LIVE_AL[id];
  }
  const legOf = (l) => ({ date: l.date, dep: l.dep, arr: l.arr, days: l.arr < l.dep ? 1 : 0, dur: l.dur, via: null, direct: null });
  function setLiveFlights(q, dateIso, data) {
    const byKey = {};
    (data.offers || []).forEach(o => {
      if (o.date !== dateIso || !OP_BY_ID[o.opId] || !(o.price > 0) || o.seats === 'none' || (o.back && o.back.seats === 'none')) return;
      const al = airlineOf(o.airline);
      // Kalit formati demo bilan bir xil: F|aviakompaniya|reys|qayerdan|qayerga|uchish|qaytish|kattalar|bolalar|klass
      const key = ['F', al.id, o.opId + '.' + o.freight, q.from, q.to, dateIso, q.ret || '', q.adults, (q.childAges || []).join('.'), q.cabin].join('|');
      liveKeys.add(key);
      if (byKey[key] && byKey[key].price <= o.price) return;
      byKey[key] = {
        key, al, op: OP_BY_ID[o.opId], to: q.to, no: o.no, backNo: o.back ? o.back.no : '', aircraft: o.aircraft || '',
        fromCode: o.fromCode, toCode: o.toCode, fromCity: o.fromCity, toCity: o.toCity,
        out: legOf(o), back: o.back ? legOf(o.back) : null, direct: null,
        bag: 'unknown', bagKg: null, price: o.price,
        seats: ['ok', 'few', 'none'].includes(o.seats) ? o.seats : 'unknown', live: true
      };
    });
    liveF[liveFSig(q, dateIso)] = { at: Date.now(), ops: data.operators || [], flights: Object.keys(byKey).map(k => byKey[k]) };
    goneVer++;
  }
  const liveFEntry = (q, dateIso) => liveF[liveFSig(q, dateIso)] || null;
  const liveFlights = (q, dateIso) => { const e = liveFEntry(q, dateIso); return e ? e.flights.filter(f => !isGone(f.key)) : []; };

  global.TB = { OPS, COUNTRIES, REGIONS, HOTELS, HOTEL_BY_ID, FROM, MEALS, ROOMS, AIRLINES, AIRPORTS, byId, UZS_RATE, date,
    offersFor: (h, q, dateIso) => (h.live ? liveOffersFor(h, q, dateIso) : offersFor(h, q, dateIso)),
    hotFor, flightsFor, isGone, hotelInfo, setBooked, setClock: (fn) => { now = fn; }, OP_BY_ID,
    live: { set: setLive, entry: liveEntry, hotels: liveHotels, sig: liveSig,
      setFlights: setLiveFlights, flightEntry: liveFEntry, flights: liveFlights, fsig: liveFSig } };
})(window);
