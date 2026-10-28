'use strict';

// Run: node --test test/ariston.test.js
const test = require('node:test');
const assert = require('node:assert');
const { AristonClient, lastDayEnergy, CONSUMPTION } = require('../com.pepane13.ariston/lib/ariston');

test('energy of the last day is the sum of the hourly buckets', () => {
  const seq = [{ k: CONSUMPTION.HP, p: 1, v: [0.1, 0.2, 0.35] }, { k: CONSUMPTION.RESISTOR, p: 2, v: [9] }];
  assert.strictEqual(lastDayEnergy(seq, CONSUMPTION.HP), 0.65);
  assert.strictEqual(lastDayEnergy(seq, CONSUMPTION.RESISTOR), null);
});

test('an expired token triggers one new login and the request is replayed', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(url.split('/api/v2/')[1]);
    if (url.endsWith('accounts/login')) return { ok: true, status: 200, text: async () => JSON.stringify({ token: `T${calls.length}` }) };
    if (calls.length === 2) return { ok: false, status: 405, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ token: opts.headers['ar.authToken'] }) };
  };
  const client = new AristonClient({ username: 'u', password: 'p' });
  const res = await client.getData('GW');
  assert.deepStrictEqual(calls, ['accounts/login', 'velis/slpPlantData/GW', 'accounts/login', 'velis/slpPlantData/GW']);
  assert.strictEqual(res.token, 'T3');
});

test('commands use the Nuos (slpPlantData) routes and payloads', async () => {
  const posts = [];
  global.fetch = async (url, opts) => {
    if (url.endsWith('accounts/login')) return { ok: true, status: 200, text: async () => '{"token":"T"}' };
    posts.push([url.split('/api/v2/')[1], opts.body]);
    return { ok: true, status: 200, text: async () => '' };
  };
  const client = new AristonClient({ username: 'u', password: 'p' });
  await client.setMode('GW', 'comfort');
  await client.setBoost('GW', true);
  await client.setTemperatures('GW', { comfort: 55, reduced: 40 }, { comfort: 45, reduced: 40 });
  assert.deepStrictEqual(posts, [
    ['velis/slpPlantData/GW/operativeMode', '{"new":1}'],
    ['velis/slpPlantData/GW/boost', 'true'],
    ['velis/slpPlantData/GW/temperatures', '{"new":{"comfort":55,"reduced":40},"old":{"comfort":45,"reduced":40}}'],
  ]);
});
