// Agent ishchilari jonli qidiruv orqali: saralash, taklif formati, tahlilchi va to'liq navbat (soxta live — tarmoqqa chiqilmaydi)
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { open } = require('../server/owner/db');
const { createOwnerService } = require('../server/owner/service');
const { createWorkerRegistry } = require('../server/owner/worker-registry');
const { createScheduler } = require('../server/owner/scheduler');
const { createMainAgent } = require('../server/owner/agent/main');
const { normalizeOffer } = require('../server/owner/normalize');
const { OPERATORS } = require('../server/live');
const { registerLiveWorkers, selectOffers, toAgentOffer, destinationMatcher, liveParams, SITE_TO_LIVE } = require('../server/owner/live-workers');
const { parseNaturalLanguage } = require('../js/agent-parser.js');

const future = (days = 40) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const offer = (o) => Object.assign({ opId: 'kompas', hotel: 'Hotel', stars: 4, city: 'Кемер', checkIn: '2026-12-15', nights: 7, meal: 'AI', room: 'Standard', price: 900, avail: 'ok', seats: 'ok', gds: false }, o);
const params = (p) => Object.assign({ destination: 'Antalya', country: 'tr', date: future(), nights: 7, adults: 2, childrenAges: [], budget: null, currency: 'USD', hotelStars: null, mealPlan: null, departureAirport: null }, p);

test('kurort filtri: Antalya butun sohil, Alanya alohida, davlat va Maldiv — filtrsiz', () => {
  const antalya = destinationMatcher('Antalya', 'tr');
  ['Кемер', 'Belek', 'Сиде', 'Анталья', 'Lara', 'Аланья'].forEach(city => assert.ok(antalya({ city, hotel: 'X' }), city));
  assert.equal(antalya({ city: 'Стамбул', hotel: 'X' }), false);
  const alanya = destinationMatcher('Alanyaga', 'tr');
  assert.ok(alanya({ city: 'Avsallar', hotel: 'X' }));
  assert.equal(alanya({ city: 'Кемер', hotel: 'X' }), false);
  assert.ok(destinationMatcher('Дубае', 'ae')({ city: 'Dubai (Deira)', hotel: 'X' }));
  assert.equal(destinationMatcher('Turkey', 'tr'), null);
  assert.equal(destinationMatcher('Male', 'mv'), null);
  // Noma'lum nom — shahar yoki mehmonxona nomida so'z boshi bo'yicha
  assert.ok(destinationMatcher('Fethiye', 'tr')({ city: 'Fethiye', hotel: 'X' }));
});

test('saralash: sotuvda yo\'q va reysda joy yo\'q chiqmaydi; ovqat, yulduz, so\'m byudjet; eng arzoni birinchi', () => {
  const list = [
    offer({ hotel: 'A', price: 1500 }),
    offer({ hotel: 'B', price: 800, avail: 'stop' }),
    offer({ hotel: 'C', price: 700, seats: 'none' }),
    offer({ hotel: 'D', price: 1000, meal: 'UAI', stars: 5 }),
    offer({ hotel: 'E', price: 600, meal: 'BB' }),
    offer({ hotel: 'F', price: 650, stars: 3 }),
    offer({ hotel: 'G', price: 500, city: 'Стамбул' })
  ];
  const all = selectOffers(list, params(), { limit: 30 }).offers.map(o => o.hotel);
  assert.deepEqual(all, ['E', 'F', 'D', 'A']);
  const ai4 = selectOffers(list, params({ mealPlan: 'AI', hotelStars: 4 }), { limit: 30 }).offers.map(o => o.hotel);
  assert.deepEqual(ai4, ['D', 'A']);
  // 12 000 000 so'm / 12 000 = 1000 USD gacha
  const uzs = selectOffers(list, params({ budget: 12000000, currency: 'UZS' }), { uzsRate: 12000, limit: 30 }).offers.map(o => o.hotel);
  assert.deepEqual(uzs, ['E', 'F', 'D']);
  assert.equal(selectOffers(list, params(), { limit: 2 }).offers.length, 2);
  const none = selectOffers([offer({ city: 'Стамбул' })], params(), { limit: 30 });
  assert.equal(none.offers.length, 0);
  assert.equal(none.placeFiltered, true);
  // Chegara bo'lsa aynan so'ralgan kun birinchi (qolgan ±3 kun — keyin)
  const day = params().date;
  const exact = selectOffers([offer({ hotel: 'X', price: 500 }), offer({ hotel: 'Y', price: 900, checkIn: day })], params(), { limit: 1 }).offers;
  assert.deepEqual(exact.map(o => o.hotel), ['Y']);
  const sold = selectOffers([offer({ avail: 'stop' }), offer({ seats: 'none' })], params(), { limit: 30 });
  assert.equal(sold.offers.length, 0);
  assert.equal(sold.soldOut, true);
});

test('taklif formati normalizatordan o\'tadi: uchish, GDS, mavjudlik, chiqish sanasi', () => {
  const raw = offer({ fromCode: 'TAS', toCode: 'AYT', depDate: '2026-12-15', dep: 6 * 60 + 40, avail: 'req', gds: true });
  const n = normalizeOffer(Object.assign(toAgentOffer(raw, params({ childrenAges: [5] }), 'https://online.uz.kompastour.com/search_tour'), { operatorName: 'Kompas Tour' }));
  assert.equal(n.hotelName, 'Hotel');
  assert.equal(n.totalPrice, 900);
  assert.equal(n.currency, 'USD');
  assert.equal(n.availability, 'on_request');
  assert.equal(n.checkOut, '2026-12-22');
  assert.equal(n.mealPlan, 'AI');
  assert.equal(n.hotelStars, 4);
  assert.equal(n.children, 1);
  assert.equal(n.departure, 'TAS → AYT · 2026-12-15 06:40');
  assert.equal(n.gds, true);
  assert.equal(n.flightIncluded, true);
  assert.equal(n.verificationStatus, 'unverified');
  assert.deepEqual(liveParams(params({ childrenAges: [5, 9], departureAirport: 'skd' })), {
    // ro'yxatdagi shahar — js/cities.js id'si (sayt filtri bilan bir xil kalit)
    country: 'tr', date: params().date, nights: '7', adults: '2', from: 'skd', window: '3', children: '5,9', city: 'antalya'
  });
  // Butun davlat (kurort yo'q) — shahar uzatilmaydi
  assert.equal('city' in liveParams(params({ destination: 'Turkey' })), false);
});

test('tahlilchi: uchish shahri va yulduz matndan', () => {
  const p = parseNaturalLanguage('Samarqanddan Antalyaga 15-dekabr 7 kecha 2 kishi 5 yulduzli hammasi kiritilgan').parameters;
  assert.equal(p.departureAirport, 'skd');
  assert.equal(p.hotelStars, 5);
  assert.equal(p.destination, 'Antalya');
  assert.equal(p.mealPlan, 'AI');
  assert.equal(parseNaturalLanguage('Из Бухары в Дубай 10 декабря 5 ночей 2 взрослых 4*').parameters.departureAirport, 'bhk');
  assert.equal(parseNaturalLanguage('Из Бухары в Дубай 10 декабря 5 ночей 2 взрослых 4*').parameters.hotelStars, 4);
  assert.equal(parseNaturalLanguage('Dubai 10 dekabr 5 kecha 2 kishi').parameters.departureAirport, null);
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tezbooking-live-workers-'));
  const database = open(join(directory, 'owner.sqlite'));
  const service = createOwnerService({ db: database });
  const workers = createWorkerRegistry();
  let scheduler = null;
  t.after(() => {
    if (scheduler) scheduler.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { database, service, workers, startScheduler(opts) { scheduler = createScheduler({ service, workers, pollMs: 20, ...opts }); scheduler.start(); return scheduler; } };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.fail('Timed out waiting for scheduler state');
}

test('to\'liq zanjir: 13 ta operator ulanadi, topshiriq navbat orqali takliflar yig\'adi, xato qayta urinilib yakunlanadi', async (t) => {
  const f = fixture(t);
  const calls = [];
  const live = {
    OPERATORS,
    async searchOne(kind, id, p) {
      calls.push({ kind, id, p });
      if (id === 'malva') return { id, status: 'error', error: 'timeout', offers: [] };
      if (id === 'selfie') return { id, status: 'no_country', offers: [] };
      if (id === 'kompas') {
        return {
          id, status: 'ok', offers: [
            offer({ opId: id, hotel: 'Kemer Pine', price: 950, fromCode: 'TAS', toCode: 'AYT', depDate: p.date, dep: 400 }),
            offer({ opId: id, hotel: 'Istanbul Inn', price: 400, city: 'Стамбул' }),
            offer({ opId: id, hotel: 'Lara Resort', price: 1200, stars: 5 })
          ]
        };
      }
      return { id, status: 'ok', offers: [offer({ opId: id, hotel: 'Belek ' + id, city: 'Belek', price: 1000 + calls.length })] };
    }
  };
  const registered = registerLiveWorkers({ live, service: f.service, workers: f.workers, maxOffers: 30 });
  // Pegas va Asialuxe faqat login bilan — testda login yo'q, ular ulanmaydi
  const loginOnly = OPERATORS.filter(op => op.loginOnly).map(op => op.id);
  assert.deepEqual(loginOnly, ['pegas', 'asialuxe']);
  assert.equal(registered.length, Object.keys(SITE_TO_LIVE).length - loginOnly.length);
  const sites = f.service.listWebsites();
  assert.equal(sites.filter(s => s.integrationStatus === 'verified').length, 13);
  assert.equal(sites.find(s => s.id === 'vietra').websiteType, 'samo');
  assert.equal(sites.find(s => s.id === 'pegas').integrationStatus, 'pending');   // jonli ulagichi yo'q
  // Ikkinchi marta ro'yxatga olish (qayta ishga tushish) — takrorlanmaydi
  assert.equal(registerLiveWorkers({ live, service: f.service, workers: f.workers }).length, 0);

  f.service.updateSettings({ workerConcurrency: 6, perOperatorConcurrency: 1, retryLimit: 1, searchTimeoutSeconds: 5 });
  const scheduler = f.startScheduler();
  const agent = createMainAgent({ service: f.service, workers: f.workers, scheduler, llmParser: null });
  const created = agent.createSearch(params({ departureAirport: 'skd' }), 'Antalya test', 'live-workers-1');
  assert.equal(created.selectedWorkers, 13);
  assert.equal(created.task.status, 'queued');

  await waitFor(() => ['completed', 'partial', 'failed'].includes(f.service.getTask(created.task.id).status));
  const task = f.service.getTask(created.task.id);
  assert.equal(task.status, 'partial');                       // malva: 2 urinishdan keyin xato
  const byOp = id => task.executions.find(e => e.websiteId === id);
  assert.equal(byOp('malva').status, 'failed');
  assert.equal(byOp('malva').attempts, 2);
  assert.equal(byOp('malva').errorCode, 'timeout');
  assert.equal(byOp('selfie').status, 'completed');
  assert.equal(byOp('selfie').offersFound, 0);
  assert.equal(byOp('kompas').offersFound, 2);                // Stamboul kurort filtri bilan chiqarildi
  assert.equal(calls.filter(c => c.id === 'malva').length, 2);
  assert.ok(calls.every(c => c.kind === 'tours' && c.p.from === 'skd' && c.p.country === 'tr'));
  assert.equal(task.offers.length, 2 + 10);                   // kompas 2 + boshqa 10 ta operatorda 1 tadan
  const kemer = task.offers.find(o => o.hotelName === 'Kemer Pine');
  assert.equal(kemer.operatorName, 'Kompas Tour');
  assert.equal(kemer.sourceUrl, 'https://online.uz.kompastour.com/search_tour');
  assert.match(kemer.offer.departure, /^TAS → AYT · \d{4}-\d{2}-\d{2} 06:40$/);
  const site = f.service.listWebsites().find(s => s.id === 'kompas');
  assert.ok(site.lastSuccessfulSearch > 0);
  assert.equal(f.service.listWebsites().find(s => s.id === 'malva').lastError, 'timeout');
  // Jurnalda natija yo'qligi sababi
  assert.ok(f.service.listLogs(200).some(l => l.eventType === 'adapter_no_offers_no_country'));
});
