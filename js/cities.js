/*
 * TezBooking — davlatlar bo'yicha kurort shaharlar (qidiruv filtri "Shahar").
 * Sayt (shahar tanlash), server (operatorning o'z shahar filtri: SAMO TOWNS, Pegas hudud/shahar, Asialuxe shahar)
 * va agentlar (topshiriqdagi kurort) shu ro'yxatdan foydalanadi.
 *
 *   { id, country, uz, ru, en, aliases }  — aliases: operatorlar yozadigan nomlar (so'z boshi bo'yicha solishtiriladi)
 * Operatorda shahar guruhi (masalan SAMO'da "Анталья" ichida "Кемер") yoki tuman nomi shu nomlardan biri bilan
 * boshlansa — o'sha shahar deb olinadi.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TB_CITIES = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CITIES = [
    // Turkiya
    { id: 'antalya', country: 'tr', uz: 'Antaliya', ru: 'Анталья', en: 'Antalya', aliases: ['antalya', 'анталья', 'анталия', 'lara', 'лара', 'kundu', 'кунду', 'konyaalti', 'коньяалты'] },
    { id: 'kemer', country: 'tr', uz: 'Kemer', ru: 'Кемер', en: 'Kemer', aliases: ['kemer', 'кемер', 'beldibi', 'бельдиби', 'goynuk', 'гейнюк', 'tekirova', 'текирова', 'camyuva', 'чамьюва', 'kiris', 'кириш'] },
    { id: 'belek', country: 'tr', uz: 'Belek', ru: 'Белек', en: 'Belek', aliases: ['belek', 'белек', 'kadriye', 'кадрие', 'bogazkent', 'богазкент'] },
    { id: 'side', country: 'tr', uz: 'Side', ru: 'Сиде', en: 'Side', aliases: ['side', 'сиде', 'manavgat', 'манавгат', 'evrenseki', 'эвренсеки', 'kizilagac', 'кызылагач', 'titreyengol', 'титрейенгель', 'colakli', 'чолаклы', 'sorgun', 'соргун'] },
    { id: 'alanya', country: 'tr', uz: 'Alanya', ru: 'Аланья', en: 'Alanya', aliases: ['alanya', 'аланья', 'avsallar', 'авсаллар', 'konakli', 'конаклы', 'okurcalar', 'окурджалар', 'incekum', 'инджекум', 'mahmutlar', 'махмутлар', 'turkler', 'тюрклер'] },
    { id: 'istanbul', country: 'tr', uz: 'Istanbul', ru: 'Стамбул', en: 'Istanbul', aliases: ['istanbul', 'стамбул'] },
    { id: 'bodrum', country: 'tr', uz: 'Bodrum', ru: 'Бодрум', en: 'Bodrum', aliases: ['bodrum', 'бодрум'] },
    { id: 'marmaris', country: 'tr', uz: 'Marmaris', ru: 'Мармарис', en: 'Marmaris', aliases: ['marmaris', 'мармарис', 'icmeler', 'ичмелер'] },
    { id: 'fethiye', country: 'tr', uz: 'Fethiye', ru: 'Фетхие', en: 'Fethiye', aliases: ['fethiye', 'фетхие', 'oludeniz', 'олюдениз'] },
    // BAA
    { id: 'dubai', country: 'ae', uz: 'Dubay', ru: 'Дубай', en: 'Dubai', aliases: ['dubai', 'дубай', 'дубаи', 'deira', 'дейра', 'jumeirah', 'джумейра', 'bur dubai', 'бур дубай'] },
    { id: 'abu-dhabi', country: 'ae', uz: 'Abu-Dabi', ru: 'Абу-Даби', en: 'Abu Dhabi', aliases: ['abu dhabi', 'abu dabi', 'абу даби'] },
    { id: 'sharjah', country: 'ae', uz: 'Sharja', ru: 'Шарджа', en: 'Sharjah', aliases: ['sharjah', 'шарджа'] },
    { id: 'ras-al-khaimah', country: 'ae', uz: 'Ras-al-Xayma', ru: 'Рас-эль-Хайма', en: 'Ras Al Khaimah', aliases: ['ras al khaimah', 'рас аль хайма', 'рас эль хайма'] },
    { id: 'fujairah', country: 'ae', uz: 'Fujayra', ru: 'Фуджейра', en: 'Fujairah', aliases: ['fujairah', 'фуджейра'] },
    { id: 'ajman', country: 'ae', uz: 'Ajman', ru: 'Аджман', en: 'Ajman', aliases: ['ajman', 'аджман'] },
    // Misr
    { id: 'hurghada', country: 'eg', uz: 'Xurgada', ru: 'Хургада', en: 'Hurghada', aliases: ['hurghada', 'хургада', 'makadi', 'макади', 'sahl hasheesh', 'сахл хашиш', 'soma bay', 'сома бей', 'el gouna', 'эль гуна', 'safaga', 'сафага'] },
    { id: 'sharm', country: 'eg', uz: 'Sharm-ash-Shayx', ru: 'Шарм-эль-Шейх', en: 'Sharm El Sheikh', aliases: ['sharm', 'шарм', 'nabq', 'набк', 'naama', 'наама'] },
    // Tailand
    { id: 'phuket', country: 'th', uz: 'Pxuket', ru: 'Пхукет', en: 'Phuket', aliases: ['phuket', 'пхукет', 'patong', 'патонг', 'karon', 'карон', 'kata', 'ката', 'kamala', 'камала', 'bang tao', 'банг тао'] },
    { id: 'pattaya', country: 'th', uz: 'Pattaya', ru: 'Паттайя', en: 'Pattaya', aliases: ['pattaya', 'паттайя', 'паттая', 'jomtien', 'джомтьен'] },
    { id: 'bangkok', country: 'th', uz: 'Bangkok', ru: 'Бангкок', en: 'Bangkok', aliases: ['bangkok', 'бангкок'] },
    { id: 'krabi', country: 'th', uz: 'Krabi', ru: 'Краби', en: 'Krabi', aliases: ['krabi', 'краби', 'ao nang', 'ао нанг'] },
    { id: 'samui', country: 'th', uz: 'Samuy', ru: 'Самуи', en: 'Koh Samui', aliases: ['samui', 'самуи'] },
    // Vyetnam
    { id: 'nha-trang', country: 'vn', uz: 'Nyachang', ru: 'Нячанг', en: 'Nha Trang', aliases: ['nha trang', 'нячанг', 'нья чанг', 'cam ranh', 'камрань'] },
    { id: 'phu-quoc', country: 'vn', uz: 'Fukuok', ru: 'Фукуок', en: 'Phu Quoc', aliases: ['phu quoc', 'фукуок', 'фу куок', 'duong dong', 'зыонг донг'] },
    { id: 'da-nang', country: 'vn', uz: 'Danang', ru: 'Дананг', en: 'Da Nang', aliases: ['da nang', 'danang', 'дананг', 'да нанг', 'hoi an', 'хойан', 'хой ан'] },
    // Gruziya, Ozarbayjon
    { id: 'tbilisi', country: 'ge', uz: 'Tbilisi', ru: 'Тбилиси', en: 'Tbilisi', aliases: ['tbilisi', 'тбилиси'] },
    { id: 'batumi', country: 'ge', uz: 'Batumi', ru: 'Батуми', en: 'Batumi', aliases: ['batumi', 'батуми'] },
    { id: 'baku', country: 'az', uz: 'Boku', ru: 'Баку', en: 'Baku', aliases: ['baku', 'баку'] },
    { id: 'gabala', country: 'az', uz: 'Gabala', ru: 'Габала', en: 'Gabala', aliases: ['gabala', 'габала', 'qabala'] },
    // Malayziya, Indoneziya, Shri-Lanka
    { id: 'kuala-lumpur', country: 'my', uz: 'Kuala-Lumpur', ru: 'Куала-Лумпур', en: 'Kuala Lumpur', aliases: ['kuala lumpur', 'куала лумпур'] },
    { id: 'langkawi', country: 'my', uz: 'Langkavi', ru: 'Лангкави', en: 'Langkawi', aliases: ['langkawi', 'лангкави'] },
    { id: 'penang', country: 'my', uz: 'Penang', ru: 'Пенанг', en: 'Penang', aliases: ['penang', 'пенанг'] },
    { id: 'bali', country: 'id', uz: 'Bali', ru: 'Бали', en: 'Bali', aliases: ['bali', 'бали', 'kuta', 'кута', 'nusa dua', 'нуса дуа', 'ubud', 'убуд', 'seminyak', 'семиньяк', 'jimbaran', 'джимбаран', 'sanur', 'санур', 'canggu', 'чангу', 'legian', 'легиан'] },
    { id: 'colombo', country: 'lk', uz: 'Kolombo', ru: 'Коломбо', en: 'Colombo', aliases: ['colombo', 'коломбо'] },
    { id: 'bentota', country: 'lk', uz: 'Bentota', ru: 'Бентота', en: 'Bentota', aliases: ['bentota', 'бентота'] },
    { id: 'hikkaduwa', country: 'lk', uz: 'Xikkaduva', ru: 'Хиккадува', en: 'Hikkaduwa', aliases: ['hikkaduwa', 'хиккадува'] }
  ];

  const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  const byId = (id) => CITIES.find(c => c.id === id) || null;
  // Shahar id'si yoki nomi ("Antalyaga", "Стамбул", "abu-dhabi") -> ro'yxatdagi shahar (yo'q bo'lsa null)
  function findCity(text, country) {
    const direct = byId(String(text || '').trim().toLowerCase());
    if (direct) return direct;
    const typed = norm(text);
    return CITIES.find(c => (!country || c.country === country) && [c.en, c.ru, c.uz].concat(c.aliases).some(a => {
      const x = norm(a).trim();
      return x.length >= 3 && (typed.includes(' ' + x + ' ') || (x.length >= 4 && typed.includes(' ' + x)));
    })) || null;
  }
  // Operator yozgan joy nomi shu shaharga tegishlimi (so'z boshi bo'yicha: "Стамбул - Фатих", "Dubai - Al Barsha")
  function cityMatcher(text, country) {
    const city = findCity(text, country);
    const terms = [...new Set((city ? [city.en, city.ru, city.uz].concat(city.aliases) : [String(text || '')])
      .map(a => norm(a).trim()).filter(a => a.length >= 3))];
    if (!terms.length) return null;
    return (name) => { const n = norm(name); return terms.some(t => n.includes(' ' + t)); };
  }
  const forCountry = (country) => CITIES.filter(c => c.country === country);
  return { CITIES, byId, findCity, cityMatcher, forCountry };
}));
