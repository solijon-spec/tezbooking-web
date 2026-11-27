'use strict';
// Operator natijasini to'liq olish: EUR narxli qatorlar (operatorning USD ga o'girgani), "yana yuklash" so'rovi (op + page).
const test = require('node:test');
const assert = require('node:assert');
const { parseRows } = require('../server/live/samo');
const { parseLiveQuery } = require('../server/live/validation');

const row = (cat, cur, conv) => `<tr class="price_info hotel_availability_Y" data-checkin="20261206" data-nights="7" data-hotel="11">` +
  `<td class="tour">Отдых в Турции</td><td class="link-hotel">Rixos 5* (Antalya)</td><td>x</td><td>AI</td><td>Standard / 2Adl</td>` +
  `<td><span data-cat-price="${cat}" data-cat-currency="${cur}"></span><span data-converted-price-number="${conv}"></span></td></tr>`;

test('SAMO: EUR price row is kept with the operator USD conversion; USD row as is', () => {
  const op = { id: 'flykhiva' };
  const [eur] = parseRows(op, row('987.19', '3', '1083'));
  assert.strictEqual(eur.price, 1083);
  assert.strictEqual(eur.opPrice, 987);
  assert.strictEqual(eur.opCurrency, 'EUR');
  const [usd] = parseRows(op, row('1060.83', '2', '1061'));
  assert.strictEqual(usd.price, 1061);
  assert.strictEqual(usd.opCurrency, undefined);
});

test('live query: op and page only together, page from 2', () => {
  const now = () => Date.parse('2026-11-27T10:00:00Z');
  const countries = { tr: [] };
  const q = (s) => parseLiveQuery('tours', new URL('http://x/api/live/tours?country=tr&date=2026-12-06&nights=7&adults=2' + s), { countries, now });
  assert.deepStrictEqual([q('&op=easybooking&page=7').op, q('&op=easybooking&page=7').page], ['easybooking', 7]);
  assert.strictEqual(q('&op=easybooking'), null);
  assert.strictEqual(q('&page=3'), null);
  assert.strictEqual(q('&op=easybooking&page=1'), null);
  assert.strictEqual(q('&op=Easy..&page=3'), null);
  assert.strictEqual(q('').op, undefined);
});
