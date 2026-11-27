'use strict';
// Qidiruv filtri: shahar (kurort) — operatorning o'z shahar filtri (SAMO TOWNS, Pegas hudud/shahar), qaytish sanasi.
const test = require('node:test');
const assert = require('node:assert');
const { findCity, cityMatcher } = require('../js/cities.js');
const { parseTowns, townKeys } = require('../server/live/samo');
const { placeFilter } = require('../server/live/pegas');
const { parseNaturalLanguage } = require('../js/agent-parser.js');
const { validateSearchParameters } = require('../server/owner/service.js');

test('cities: id, name and inflected forms resolve; operator district names match by word start', () => {
  assert.strictEqual(findCity('istanbul').id, 'istanbul');
  assert.strictEqual(findCity('Стамбул').id, 'istanbul');
  assert.strictEqual(findCity('Antalyaga', 'tr').id, 'antalya');
  assert.strictEqual(findCity('Dubayga').id, 'dubai');
  const ist = cityMatcher('istanbul', 'tr');
  assert.ok(ist('Стамбул - Фатих'));
  assert.ok(!ist('Анталья'));
  const dubai = cityMatcher('dubai', 'ae');
  assert.ok(dubai('Dubai - Al Barsha'));
  assert.ok(!dubai('Шарджа'));
});

// Easybooking BAA javobidan (2026-11-27) qisqartirilgan TOWNS bloki
const TOWNS = `controls.TOWNS).html("<div class="groupbox">
  <label class="groupname"><input type="checkbox" class="group"
     />Абу-Даби
  </label>
  <div class="groupboxChildren"><label class=" hidden">
     <input type="checkbox"   value="3225"/>
        Abu Dhabi - Saadiyat Island
  </label></div>
  <div class="groupboxChildren"><label class=" hidden"><input type="checkbox"   value="1355"/> Абу-Даби </label></div>
</div>
<div class="groupbox"><label class="groupname"><input type="checkbox" class="group" />Дубай</label>
  <div class="groupboxChildren"><label><input type="checkbox" value="1353"/> Дубай </label></div>
  <div class="groupboxChildren"><label><input type="checkbox" value="1360"/> Шарджа </label></div>
</div>"); controls.MEALS).html("")`;

test('SAMO: town groups parsed; a city picks its whole group or only matching districts', () => {
  const towns = parseTowns(TOWNS);
  assert.deepStrictEqual(towns.map(g => g.name), ['Абу-Даби', 'Дубай']);
  assert.deepStrictEqual(townKeys(towns, cityMatcher('abu-dhabi', 'ae')), ['3225', '1355']);
  assert.deepStrictEqual(townKeys(towns, cityMatcher('sharjah', 'ae')), ['1360']);
  assert.deepStrictEqual(townKeys(towns, cityMatcher('fujairah', 'ae')), []);
});

test('Pegas: region first, then location, then area', () => {
  const places = [{ id: 77, level: 0, name: 'Анталья' }, { id: 7192, level: 1, name: 'Белек' }, { id: 78, level: 1, name: 'Анталья' },
    { id: 7215, level: 2, name: 'Кемер Центр' }, { id: 7216, level: 2, name: 'Центр Белека' }];
  assert.deepStrictEqual(placeFilter(places, cityMatcher('antalya', 'tr')), { HotelRegionIds: [77] });
  assert.deepStrictEqual(placeFilter(places, cityMatcher('belek', 'tr')), { HotelLocationIds: [7192] });
  assert.deepStrictEqual(placeFilter(places, cityMatcher('kemer', 'tr')), { HotelLocationAreaIds: [7215] });
  assert.strictEqual(placeFilter(places, cityMatcher('istanbul', 'tr')), null);
});

test('agent command: return date gives the nights, like the site filter', () => {
  const year = new Date().getUTCFullYear() + 1;
  const a = parseNaturalLanguage(`Istanbul 15-22 dekabr ${year} 2 kishi`).parameters;
  assert.strictEqual(a.date, `${year}-12-15`);
  assert.strictEqual(a.returnDate, `${year}-12-22`);
  assert.strictEqual(a.nights, 7);
  const b = parseNaturalLanguage(`Dubay 10.03.${year} - 20.03.${year}, 2 kattalar`).parameters;
  assert.deepStrictEqual([b.date, b.returnDate, b.nights], [`${year}-03-10`, `${year}-03-20`, 10]);
  const c = parseNaturalLanguage(`Antalya 10.06.${year} 7 kecha 2 kishi`).parameters;
  assert.deepStrictEqual([c.returnDate, c.nights], [null, 7]);
});

test('owner task: returnDate sets nights; return before departure is rejected', () => {
  const now = () => Date.parse('2026-11-27T08:00:00Z');
  const base = { destination: 'Istanbul', country: 'tr', date: '2026-12-15', adults: 2 };
  assert.strictEqual(validateSearchParameters(Object.assign({}, base, { returnDate: '2026-12-25' }), now).nights, 10);
  assert.strictEqual(validateSearchParameters(Object.assign({}, base, { returnDate: '2026-12-10', nights: 7 }), now), null);
});
