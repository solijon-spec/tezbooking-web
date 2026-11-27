/*
 * Main Agent'ning qoidaviy (deterministic) tahlilchisi: oddiy matndan qidiruv parametrlari.
 * Bitta fayl ikki joyda ishlaydi: serverda (server/owner/agent/parser.js orqali) va brauzerdagi
 * demo'da (js/demo-api.js → admin panel "Agentlar" bo'limi, window.TezAgentParser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TezAgentParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// O'zbek (lotin/kirill), rus va ingliz nomlari. 4+ harfli nomlar so'z boshi bo'yicha ham topiladi:
// "Antalyaga", "Turkiyaga", "Турцию", "Дубае" kabi qo'shimchali shakllar ham tushuniladi.
const COUNTRIES = [
  ['tr', ['turkey', 'türkiye', 'turkiya', 'туркия', 'турци', 'турция']],
  ['ge', ['georgia', 'gruziya', 'грузия', 'грузи', 'sakartvelo']],
  ['az', ['azerbaijan', 'ozarbayjon', 'озарбайжон', 'азербайджан']],
  ['ae', ['uae', 'baa', 'united arab emirates', 'emirates', 'arab amirliklari', 'оаэ', 'объединенные арабские эмираты', 'эмират']],
  ['eg', ['egypt', 'misr', 'миср', 'египет', 'египт']],
  ['my', ['malaysia', 'malayziya', 'малайзия', 'малайзи']],
  ['th', ['thailand', 'tailand', 'tayland', 'тайланд', 'таиланд']],
  ['vn', ['vietnam', 'vyetnam', 'вьетнам']],
  ['id', ['indonesia', 'indoneziya', 'индонезия', 'индонези']],
  ['lk', ['sri lanka', 'shri lanka', 'шри-ланка', 'шри ланка']],
  ['mv', ['maldives', 'maldiv', 'мальдив']]
];
const COUNTRY_CODES = COUNTRIES.map(([code]) => code);   // server/live/samo.js COUNTRY_RU bilan bir xil 11 ta

const DESTINATIONS = [
  ['Antalya', 'tr', ['antalya', 'анталья', 'анталь', 'анталия']],
  ['Alanya', 'tr', ['alanya', 'аланья', 'алань']],
  ['Istanbul', 'tr', ['istanbul', 'стамбул']],
  ['Bodrum', 'tr', ['bodrum', 'бодрум']],
  ['Tbilisi', 'ge', ['tbilisi', 'тбилиси']],
  ['Batumi', 'ge', ['batumi', 'батуми']],
  ['Baku', 'az', ['baku', 'boku', 'баку', 'боку']],
  ['Dubai', 'ae', ['dubai', 'dubay', 'дубай', 'дубаи', 'дубае']],
  ['Abu Dhabi', 'ae', ['abu dhabi', 'abu dabi', 'абу даби']],
  ['Hurghada', 'eg', ['hurghada', 'xurgada', 'хургада', 'хургад']],
  ['Sharm El Sheikh', 'eg', ['sharm el sheikh', 'sharm', 'шарм-эль-шейх', 'шарм']],
  ['Phuket', 'th', ['phuket', 'pxuket', 'puket', 'пхукет']],
  ['Bangkok', 'th', ['bangkok', 'бангкок']],
  ['Nha Trang', 'vn', ['nha trang', 'nyachang', 'нячанг']],
  ['Phu Quoc', 'vn', ['phu quoc', 'fukuok', 'fukuoq', 'фукуок', 'фу куок']],
  ['Da Nang', 'vn', ['da nang', 'danang', 'дананг', 'да нанг']],
  ['Bali', 'id', ['bali', 'бали']],
  ['Colombo', 'lk', ['colombo', 'kolombo', 'коломбо']],
  ['Male', 'mv', ['male', 'мале']],
  ['Maldives', 'mv', ['maldives', 'maldiv', 'мальдив']]
];

// Uchish shaharlari (server/live/validation.js FROM_IDS bilan bir xil): "Samarqanddan", "из Ташкента", "from Bukhara"
const FROM_CITIES = [
  ['tas', ['toshkent', 'tashkent', 'ташкент', 'тошкент']],
  ['skd', ['samarqand', 'samarkand', 'самарканд', 'самарқанд']],
  ['bhk', ['buxoro', 'bukhara', 'бухар', 'бухоро']],
  ['ugc', ['urganch', 'urgench', 'ургенч', 'урганч']],
  ['nma', ['namangan', 'наманган']],
  ['feg', ['fargona', 'farg ona', 'fargʻona', 'fergana', 'ферган', 'фарғона']],
  ['azn', ['andijon', 'andijan', 'андижан', 'андижон']],
  ['tmj', ['termiz', 'termez', 'термез', 'термиз']],
  ['nvi', ['navoiy', 'navoi', 'навои', 'навоий']],
  ['ksq', ['qarshi', 'karshi', 'карши', 'қарши']],
  ['ncu', ['nukus', 'нукус']],
  ['dyu', ['dushanbe', 'душанбе']]
];

function normalizedText(text) {
  return ` ${String(text).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

function includesWord(text, alias) {
  const a = alias.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (text.includes(` ${a} `)) return true;
  // So'z boshi: faqat 4+ harfli nomlarda (qisqa so'zlarda tasodifiy moslik bo'lmasin)
  return a.length >= 4 && text.includes(` ${a}`);
}

// Oy nomlari: o'zbek (lotin/kirill), rus, ingliz — so'z boshi bo'yicha
const MONTHS = [
  ['yanvar', 'январ', 'jan'], ['fevral', 'феврал', 'feb'], ['mart', 'март', 'mar'], ['aprel', 'апрел', 'apr'],
  ['may', 'май', 'мая', 'ма'], ['iyun', 'июн', 'jun'], ['iyul', 'июл', 'jul'], ['avgust', 'август', 'aug'],
  ['sentabr', 'sentyabr', 'сентябр', 'sep'], ['oktabr', 'oktyabr', 'октябр', 'oct'], ['noyabr', 'ноябр', 'nov'],
  ['dekabr', 'декабр', 'dec']
];
function monthIndex(word) {
  const w = word.toLocaleLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].some(m => (m.length <= 2 ? w === 'мая' || w === 'май' : w.startsWith(m)))) return i;
  }
  return -1;
}
function today() { return new Date().toISOString().slice(0, 10); }

function countryCode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (COUNTRY_CODES.includes(candidate)) return candidate;
  const normalized = normalizedText(candidate);
  const match = COUNTRIES.find(([, aliases]) => aliases.some(alias => includesWord(normalized, alias)));
  return match ? match[0] : null;
}

function parseDate(text) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
  // "15-dekabr", "15 декабря 2026", "December 15", "dekabr 15"
  const pad = n => String(n).padStart(2, '0');
  const build = (day, month, year) => {
    if (month < 0 || !(day >= 1 && day <= 31)) return null;
    let y = year ? Number(year) : Number(today().slice(0, 4));
    let iso = `${y}-${pad(month + 1)}-${pad(day)}`;
    if (!year && iso < today()) iso = `${++y}-${pad(month + 1)}-${pad(day)}`;   // yil yozilmasa — eng yaqin kelajak
    return iso;
  };
  const dayFirst = /(?:^|[^\p{L}\p{N}])(\d{1,2})\s*[-.]?\s*([\p{L}]{3,})\.?(?:\s+(20\d{2}))?/gu;
  let m;
  while ((m = dayFirst.exec(text))) {
    const r = build(Number(m[1]), monthIndex(m[2]), m[3]);
    if (r) return r;
  }
  const monthFirst = /(?:^|[^\p{L}\p{N}])([\p{L}]{3,})\.?\s+(\d{1,2})(?![\d\p{L}])(?:,?\s+(20\d{2}))?/gu;
  while ((m = monthFirst.exec(text))) {
    const r = build(Number(m[2]), monthIndex(m[1]), m[3]);
    if (r) return r;
  }
  return null;
}

// Uchish va qaytish sanasi (sayt filtridagidek): "15-22 dekabr", "15–22 декабря", "15.12.2026 - 22.12.2026",
// "2026-12-15 dan 2026-12-22 gacha", "15.12 uchish, qaytish 22.12". Qaytish sanasi bo'lsa — tunlar soni undan.
function parseTrip(text) {
  const pad = n => String(n).padStart(2, '0');
  const yearOf = (y) => (y ? Number(y) : Number(today().slice(0, 4)));
  const iso = (d, m, y) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const future = (d, m, y) => { let r = iso(d, m, yearOf(y)); if (!y && r < today()) r = iso(d, m, yearOf(y) + 1); return r; };
  const after = (a, b) => (b > a ? b : b.replace(/^\d{4}/, String(Number(b.slice(0, 4)) + 1)));
  // "15-22 dekabr" — bir oy ichida oraliq
  const range = text.match(/(?:^|[^\p{L}\p{N}])(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*[-.]?\s*([\p{L}]{3,})\.?(?:\s+(20\d{2}))?/u);
  if (range && monthIndex(range[3]) >= 0 && +range[1] >= 1 && +range[1] <= 31 && +range[2] >= 1 && +range[2] <= 31) {
    const m = monthIndex(range[3]);
    const start = future(+range[1], m, range[4]);
    let end = iso(+range[2], m, Number(start.slice(0, 4)));
    if (end <= start) end = iso(+range[2], (m + 1) % 12, Number(start.slice(0, 4)) + (m === 11 ? 1 : 0));
    return { date: start, returnDate: end };
  }
  // Ikkita aniq sana: ISO, 15.12.2026 yoki 15.12 (yilsiz — eng yaqin kelajak)
  const found = [];
  const re = /\b(20\d{2})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?(?![\d./])/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) found.push(`${m[1]}-${m[2]}-${m[3]}`);
    else if (+m[4] >= 1 && +m[4] <= 31 && +m[5] >= 1 && +m[5] <= 12) found.push(future(+m[4], +m[5] - 1, m[6]));
  }
  if (found.length >= 2) {
    const ret = after(found[0], found[1]);
    const days = Math.round((Date.parse(ret) - Date.parse(found[0])) / 86400000);
    if (days >= 1 && days <= 30) return { date: found[0], returnDate: ret };
  }
  return null;
}

function parseChildren(text) {
  const ages = [];
  const explicitList = text.match(/(?:children|kids|child|bolalar|bola|дет(?:и|ей|и))\s*(?:ages?|aged?|yosh(?:lari)?|лет)\s*[:=]?\s*(\d{1,2}(?:\s*(?:,|and|&|ва|и)\s*\d{1,2})*)/i);
  if (explicitList) {
    ages.push(...explicitList[1].match(/\d{1,2}/g).map(Number));
  } else {
    const agePattern = /(?:child|kid|bola|ребен\w*)\D{0,18}(\d{1,2})\s*(?:years?\s*old|years?|yrs?|y\/o|yosh(?:li)?|лет)/giu;
    let match;
    while ((match = agePattern.exec(text))) ages.push(Number(match[1]));
  }
  const countMatch = text.match(/\b(\d{1,2})\s*(?:child(?:ren)?|kids?|bolalar|bola|ребен(?:ок|ка|ей))\b/i);
  const childCount = countMatch ? Number(countMatch[1]) : ages.length;
  return { ages, childCount };
}

// ---------- Mehmonxona nomi ----------
// Uch xil yozilishi tushuniladi (birinchi topilgani olinadi):
//   1) qo'shtirnoqda: "Rixos Premium Belek", «Camia Resort»
//   2) kalit so'zdan keyin: "hotel Camia Resort, ...", "mehmonxona: Rixos Belek", "отель Rixos Premium 5*"
//   3) KATTA HARFLI 2+ so'z (operatorlar shunday yozadi): "CAMIA RESORT 4* - PHU QUOC NORTH"
// Nomdan joy nomlari (davlat, kurort, uchish shahri), ovqatlanish, valyuta va "tur/paket" so'zlari olib tashlanadi.
const HOTEL_KEYWORD = /(?:^|[^\p{L}])(?:hotel|otel|mehmonxona|меҳмонхона|мехмонхона|отель|гостиница)(?![\p{L}])\s*[:\-–—]?\s*([^,;\n|]*)/iu;
const NAME_STOP = new Set(['all', 'inclusive', 'ultra', 'uai', 'ai', 'bb', 'hb', 'fb', 'ro', 'usd', 'eur', 'uzs', 'tur', 'tour', 'тур',
  'paket', 'package', 'пакет', 'hotel', 'otel', 'отель', 'mehmonxona', 'north', 'south', 'east', 'west', 'gacha', 'dan', 'ga']);
const plainWord = (w) => w.toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}&']+/gu, '');
let placeWordLists = null;
function placeLists() {
  if (!placeWordLists) {
    const aliases = [].concat(...DESTINATIONS.map(d => [d[0]].concat(d[2])), ...COUNTRIES.map(c => c[1]), ...FROM_CITIES.map(c => c[1]));
    placeWordLists = [...new Set(aliases.map(a => a.toLocaleLowerCase()))]
      .map(a => a.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(plainWord)).filter(list => list.length && list.join('').length >= 3)
      .sort((a, b) => b.length - a.length);
  }
  return placeWordLists;
}
function cleanHotelName(raw) {
  // Yulduzdan ("4*", "5 yulduz") va raqamdan (sana, kecha, kishi) keyingi qism — nomga kirmaydi
  const words = String(raw || '').replace(/[«»"“”„]/g, ' ').split(/\s+/).filter(Boolean);
  const cut = words.findIndex(w => /\d|\*/.test(w) || /^[-–—]$/.test(w));
  const kept = (cut < 0 ? words : words.slice(0, cut));
  const plain = kept.map(plainWord);
  const drop = new Array(kept.length).fill(false);
  placeLists().forEach(list => {
    for (let i = 0; i + list.length <= plain.length; i++) {
      if (list.every((w, j) => plain[i + j] === w)) for (let j = 0; j < list.length; j++) drop[i + j] = true;
    }
  });
  const name = kept.filter((w, i) => !drop[i] && plain[i] && !NAME_STOP.has(plain[i])).join(' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  return name.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 && name.length <= 80 ? name : null;
}
function parseHotelName(text) {
  const quoted = text.match(/["«“„]([^"«»“”„\n]{3,80})["»”“]/u);
  if (quoted) {
    const name = cleanHotelName(quoted[1]);
    if (name) return name;
  }
  const keyword = text.match(HOTEL_KEYWORD);
  if (keyword) {
    const name = cleanHotelName(keyword[1].split(/\s[-–—]\s/)[0]);
    if (name) return name;
  }
  const caps = /(?:^|[^\p{L}\p{N}])([A-Z][A-Z0-9'’&.]*(?:\s+(?:&|[A-Z][A-Z0-9'’&.]*))+)(?![\p{L}])/gu;
  let m;
  while ((m = caps.exec(text))) {
    const name = cleanHotelName(m[1]);
    if (name) return name;
  }
  return null;
}

function parseNaturalLanguage(text) {
  const normalized = normalizedText(text);
  let destination = DESTINATIONS.find(([, , aliases]) => aliases.some(alias => includesWord(normalized, alias)));
  let country = destination ? destination[1] : null;
  let countryOnly = null;
  if (!country) {
    const found = COUNTRIES.find(([, aliases]) => aliases.some(alias => includesWord(normalized, alias)));
    country = found ? found[0] : null;
    countryOnly = found;
  }
  const hotelName = parseHotelName(text);
  // Mehmonxona nomi bor, kurort yozilmagan — butun davlat bo'yicha (mehmonxona joyni o'zi belgilaydi)
  if (!destination && hotelName && countryOnly) {
    const label = countryOnly[1][0];
    destination = [label.length <= 3 ? label.toUpperCase() : label.replace(/^./, c => c.toUpperCase()), countryOnly[0], []];
  }

  // \b kirill harflarida ishlamaydi — shuning uchun (?![\p{L}]) ishlatiladi
  const adultsMatch = text.match(/(?<![\p{L}\p{N}])(\d{1,2})\s*(?:adults?|grown[- ]?ups?|kattalar|katta|kishi|odam|nafar|pax|persons?|people|взросл\p{L}*|человек\p{L}*|чел)(?![\p{L}])/iu);
  const nightsMatch = text.match(/(?<![\p{L}\p{N}])(\d{1,2})\s*(?:nights?|tun(?:lar|ga)?|kecha(?:lar|ga)?|ноч\p{L}*)(?![\p{L}])/iu);
  const children = parseChildren(text);
  let mealPlan = null;
  if (/\b(?:ultra\s+all[- ]inclusive|uai)\b/i.test(text)) mealPlan = 'UAI';
  else if (/\b(?:all[- ]inclusive|ai)\b|hammasi\s+kiritilgan|все\s+включено/iu.test(text)) mealPlan = 'AI';
  else if (/\b(?:full[- ]board|fb)\b|полный\s+пансион/iu.test(text)) mealPlan = 'FB';
  else if (/\b(?:half[- ]board|hb)\b|полупансион/iu.test(text)) mealPlan = 'HB';
  else if (/\b(?:breakfast(?:\s+included)?|bb)\b|nonushta|завтрак/iu.test(text)) mealPlan = 'BB';
  else if (/\b(?:room[- ]only|ro)\b|без\s+питания/iu.test(text)) mealPlan = 'RO';

  const budgetMatch = text.match(/(?:budget|byudjet|up\s+to|максимум|бюджет)\s*[:=]?\s*(\$|€)?\s*([\d,]+(?:\.\d+)?)\s*(USD|EUR|UZS|сум|so['’]?m|dollar)?/iu)
    || text.match(/(\$)?\s*([\d,]+(?:\.\d+)?)\s*(USD|EUR|UZS|so['’]?m|dollar)?\s*gacha/iu);
  const currencyMatch = text.match(/\b(USD|EUR|UZS)\b/i);
  const budget = budgetMatch ? Number(budgetMatch[2].replace(/,/g, '')) : null;
  const currency = budgetMatch && budgetMatch[3]
    ? (/^(сум|so['’]?m)$/i.test(budgetMatch[3]) ? 'UZS' : /^dollar$/i.test(budgetMatch[3]) ? 'USD' : budgetMatch[3].toUpperCase())
    : budgetMatch && budgetMatch[1] === '€' ? 'EUR'
      : budgetMatch && budgetMatch[1] === '$' ? 'USD'
    : currencyMatch ? currencyMatch[1].toUpperCase() : 'USD';

  const from = FROM_CITIES.find(([, aliases]) => aliases.some(alias => includesWord(normalized, alias)));
  // "5 yulduzli", "4*", "5 звезд", "4 stars" — kamida shuncha yulduz
  const starsMatch = text.match(/(?<![\p{L}\p{N}])([1-5])\s*(?:\*|yulduz\p{L}*|звезд\p{L}*|звёзд\p{L}*|stars?)(?![\p{L}])/iu);

  const missing = [];
  if (!destination) missing.push('destination');
  if (!country) missing.push('country');
  const trip = parseTrip(text);
  const date = trip ? trip.date : parseDate(text);
  const returnDate = trip ? trip.returnDate : null;
  // Qaytish sanasi bo'lsa — tunlar soni undan (sayt filtridagidek)
  const nights = returnDate ? Math.round((Date.parse(returnDate) - Date.parse(date)) / 86400000)
    : nightsMatch ? Number(nightsMatch[1]) : null;
  if (!date) missing.push('date');
  if (!adultsMatch) missing.push('adults');
  if (!nights) missing.push('nights');
  if (children.childCount > children.ages.length) missing.push('childrenAges');

  const parameters = {
    destination: destination ? destination[0] : null,
    country,
    date,
    adults: adultsMatch ? Number(adultsMatch[1]) : null,
    nights,
    returnDate,
    childrenAges: children.ages,
    mealPlan,
    budget: Number.isFinite(budget) ? budget : null,
    currency,
    hotelStars: starsMatch ? Number(starsMatch[1]) : null,
    departureAirport: from ? from[0] : null,
    hotelName
  };
  return { parameters, missing: [...new Set(missing)], mode: 'deterministic' };
}

return { parseNaturalLanguage, parseHotelName, countryCode, COUNTRIES, DESTINATIONS, FROM_CITIES };
});
