'use strict';

// Scenarios taken from the "02. Cumulus ARISTON" Flow the app replaces. Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('../com.pepane13.ariston/lib/controller');

const TZ = 'Europe/Paris';
const at = (iso) => new Date(iso).getTime(); // ISO with +01:00 / +02:00 offset
const MIN = 60000;

function run(steps, settings = {}) {
  let state = null;
  let out;
  for (const s of steps) {
    out = evaluate({
      timeZone: TZ, water: 48, boostOn: false, solarW: 0, batteryPct: 50, evCharging: false,
      tariff: { period: 'HP', today: 'BLEU', tomorrow: 'BLEU' }, ...s,
    }, settings, state);
    state = out.state;
  }
  return out;
}

test('base setpoint by default', () => {
  const r = run([{ now: at('2026-10-28T10:00:00+01:00') }]);
  assert.deepStrictEqual(r.target, { setpoint: 45, mode: 'green', reason: 'base' });
});

test('solar 500 W for 2 min, car not charging: 52 °C Green, kept until 17:00', () => {
  const t0 = at('2026-10-28T11:00:00+01:00');
  let r = run([{ now: t0, solarW: 600 }, { now: t0 + MIN, solarW: 600 }]);
  assert.strictEqual(r.target.reason, 'base');
  r = run([{ now: t0, solarW: 600 }, { now: t0 + 2 * MIN, solarW: 600 }, { now: t0 + 3 * 60 * MIN, solarW: 0 }]);
  assert.deepStrictEqual(r.target, { setpoint: 52, mode: 'green', reason: 'solar' });
  r = run([{ now: t0, solarW: 600 }, { now: t0 + 2 * MIN, solarW: 600 }, { now: at('2026-10-28T17:01:00+01:00'), solarW: 0 }]);
  assert.strictEqual(r.target.reason, 'base');
});

test('solar ignored while the car is charging', () => {
  const t0 = at('2026-10-28T11:00:00+01:00');
  const r = run([{ now: t0, solarW: 900, evCharging: true }, { now: t0 + 5 * MIN, solarW: 900, evCharging: true }]);
  assert.strictEqual(r.target.reason, 'base');
});

test('battery above 95 % in the sun: 55 °C Comfort wins over solar', () => {
  const t0 = at('2026-10-28T12:00:00+01:00');
  const r = run([{ now: t0, solarW: 800 }, { now: t0 + 3 * MIN, solarW: 800 }, { now: t0 + 4 * MIN, solarW: 800, batteryPct: 96 }]);
  assert.deepStrictEqual(r.target, { setpoint: 55, mode: 'comfort', reason: 'battery' });
});

test('battery full at night does not heat', () => {
  const r = run([{ now: at('2026-10-28T21:00:00+01:00'), batteryPct: 99, solarW: 0 }]);
  assert.strictEqual(r.target.reason, 'base');
});

test('23:00 off-peak, water below 50: 52 °C, cleared when peak hours start', () => {
  const night = { tariff: { period: 'HC', today: 'BLEU', tomorrow: 'BLEU' } };
  let r = run([{ now: at('2026-10-20T22:59:00+02:00'), water: 47, ...night }, { now: at('2026-10-20T23:00:00+02:00'), water: 47, ...night }]);
  assert.deepStrictEqual(r.target, { setpoint: 52, mode: 'green', reason: 'night' });
  r = run([
    { now: at('2026-10-20T23:00:00+02:00'), water: 47, ...night },
    { now: at('2026-10-21T05:59:00+02:00'), water: 52, ...night },
    { now: at('2026-10-21T06:00:00+02:00'), water: 52 },
  ]);
  assert.strictEqual(r.target.reason, 'base');
});

test('23:00 with hot water: no top-up', () => {
  const r = run([{ now: at('2026-10-20T23:00:00+02:00'), water: 55, tariff: { period: 'HC', today: 'BLEU', tomorrow: 'BLEU' } }]);
  assert.strictEqual(r.target.reason, 'base');
});

test('night before a red day: preheat to 55 °C', () => {
  const r = run([{ now: at('2026-12-01T23:00:00+01:00'), water: 50, tariff: { period: 'HC', today: 'BLEU', tomorrow: 'ROUGE' } }]);
  assert.deepStrictEqual(r.target, { setpoint: 55, mode: 'comfort', reason: 'red_eve' });
});

test('red day peak hours: low setpoint, boost refused, solar still allowed', () => {
  const red = { tariff: { period: 'HP', today: 'ROUGE', tomorrow: 'BLEU' } };
  let r = run([{ now: at('2026-12-02T09:00:00+01:00'), ...red }]);
  assert.deepStrictEqual(r.target, { setpoint: 40, mode: 'green', reason: 'red_peak' });
  r = run([{ now: at('2026-12-02T09:00:00+01:00'), boostOn: true, ...red }]);
  assert.strictEqual(r.boost, false);
  const t0 = at('2026-12-02T12:00:00+01:00');
  r = run([{ now: t0, solarW: 700, ...red }, { now: t0 + 2 * MIN, solarW: 700, ...red }]);
  assert.strictEqual(r.target.reason, 'solar');
});

test('manual boost stopped after 60 min, back to base', () => {
  const t0 = at('2026-10-28T09:00:00+01:00');
  let r = run([{ now: t0, boostOn: true }, { now: t0 + 59 * MIN, boostOn: true }]);
  assert.strictEqual(r.boost, null);
  r = run([{ now: t0, boostOn: true }, { now: t0 + 60 * MIN, boostOn: true }]);
  assert.strictEqual(r.boost, false);
  assert.strictEqual(r.events[0].type, 'boost_stopped');
  assert.strictEqual(r.target.reason, 'base');
});

test('anti-legionella: strong sun early in the month, done at 64 °C, once a month', () => {
  const t0 = at('2026-11-03T12:00:00+01:00');
  let r = run([{ now: t0, solarW: 2200 }, { now: t0 + 15 * MIN, solarW: 2200 }]);
  assert.deepStrictEqual(r.target, { setpoint: 65, mode: 'comfort', reason: 'legionella' });
  r = run([
    { now: t0, solarW: 2200 }, { now: t0 + 15 * MIN, solarW: 2200 },
    { now: t0 + 90 * MIN, solarW: 2200, water: 64 },
    { now: t0 + 24 * 60 * MIN, solarW: 2500 }, { now: t0 + 24 * 60 * MIN + 20 * MIN, solarW: 2500 },
  ]);
  assert.strictEqual(r.state.legio.doneMonth, '2026-11');
  assert.notStrictEqual(r.target.reason, 'legionella');
});

test('anti-legionella: no sun window after day 5, fallback on the 28th at 22:30 off-peak', () => {
  const hc = { tariff: { period: 'HC', today: 'BLEU', tomorrow: 'BLEU' } };
  let r = run([{ now: at('2026-11-10T12:00:00+01:00'), solarW: 2500 }, { now: at('2026-11-10T12:30:00+01:00'), solarW: 2500 }]);
  assert.notStrictEqual(r.target.reason, 'legionella');
  r = run([{ now: at('2026-11-28T22:30:00+01:00'), ...hc }]);
  assert.strictEqual(r.target.reason, 'legionella');
});

test('a manual setpoint is kept until the next reset', () => {
  const t0 = at('2026-10-28T10:00:00+01:00');
  let r = run([{ now: t0 }]);
  const state = { ...r.state, manual: { setpoint: 60, mode: 'comfort' } };
  r = evaluate({
    now: t0 + 60 * MIN, timeZone: TZ, water: 50, tariff: { period: 'HP' },
  }, {}, state);
  assert.strictEqual(r.target.reason, 'manual');
  r = evaluate({
    now: at('2026-10-28T17:00:00+01:00'), timeZone: TZ, water: 50, tariff: { period: 'HP' },
  }, {}, r.state);
  assert.strictEqual(r.target.reason, 'base');
});
