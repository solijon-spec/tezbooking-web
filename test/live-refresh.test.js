'use strict';
// Fon yangilash: faol qidiruvlar har refreshMs da operatorlardan qayta tortiladi; xato bergan operatorning eski paketlari qoladi;
// hech kim ko'rmayotgan qidiruv yangilanmaydi.
const test = require('node:test');
const assert = require('node:assert');
const { createLive } = require('../server/live/index');

const MIN = 60000;
function setup() {
  let clock = Date.parse('2026-11-27T08:00:00Z');
  let round = 0;
  const calls = [];
  const live = createLive({
    sendJson: () => {},
    operators: [{ id: 'kompas', search: 'https://a.example/search_tour' }, { id: 'centrum', search: 'https://b.example/search_tour' }],
    searches: {
      tours: async (op) => {
        calls.push(op.id);
        if (op.id === 'centrum' && round > 0) throw Object.assign(new Error('slow'), { name: 'AbortError' });
        return { offers: [{ opId: op.id, hotel: 'H ' + op.id, checkIn: '2026-12-06', nights: 7, price: 1000 + round, avail: 'ok' }] };
      },
      hotels: async () => ({ offers: [] }), flights: async () => ({ offers: [] })
    },
    config: { globalConcurrency: 4, operatorConcurrency: 2, maxQueue: 10, perClientRate: 100, globalRate: 100, tourTickets: false },
    now: () => clock, siteWaitMs: 1000, refreshMs: 5 * MIN, activeMs: 30 * MIN
  });
  live.stop();
  return { live, calls, tick: (ms) => { clock += ms; }, next: () => { round++; } };
}
const params = { country: 'tr', date: '2026-12-06', nights: '7', adults: '2', window: '3' };

test('active search is re-fetched every 5 minutes; failed operator keeps its previous packages', async () => {
  const s = setup();
  const first = await s.live.search('tours', params);
  assert.deepStrictEqual(first.offers.map(o => o.price).sort(), [1000, 1000]);
  s.tick(2 * MIN);
  assert.strictEqual(await s.live.refreshTick(), 0, 'not due yet');
  s.next();
  s.tick(3 * MIN);
  assert.strictEqual(await s.live.refreshTick(), 1);
  const again = await s.live.search('tours', params);
  const by = Object.fromEntries(again.offers.map(o => [o.opId, o.price]));
  assert.strictEqual(by.kompas, 1001, 'fresh price from the operator');
  assert.strictEqual(by.centrum, 1000, 'operator failed this time — previous packages kept');
  assert.strictEqual(again.operators.find(o => o.id === 'centrum').stale, true);
});

test('search nobody looked at for 30 minutes is not refreshed; agent single-operator cache is refreshed', async () => {
  const s = setup();
  await s.live.search('tours', params);
  s.tick(31 * MIN);
  assert.strictEqual(await s.live.refreshTick(), 0);
  const one = await s.live.searchOne('tours', 'kompas', Object.assign({}, params, { date: '2026-12-07' }));
  assert.strictEqual(one.status, 'ok');
  assert.strictEqual(one.offers[0].price, 1000);
  s.next(); s.tick(5 * MIN);
  const before = s.calls.length;
  assert.ok(await s.live.refreshTick() >= 1);
  assert.ok(s.calls.length > before);
  const fresh = await s.live.searchOne('tours', 'kompas', Object.assign({}, params, { date: '2026-12-07' }));
  assert.strictEqual(fresh.offers[0].price, 1001, 'agent gets the re-fetched package');
});
