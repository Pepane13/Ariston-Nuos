'use strict';

/**
 * Minimal client for the Ariston NET cloud API (www.ariston-net.remotethermo.com/api/v2),
 * limited to what a Nuos heat pump water heater needs.
 *
 * The API is not publicly documented. Endpoints and payloads follow the reverse-engineered
 * python-ariston-api project (fustom/python-ariston-api, used by the Home Assistant
 * integration): Nuos models are "Velis" plants with wheType 4 and use the slpPlantData routes.
 */

const API_URL = 'https://www.ariston-net.remotethermo.com/api/v2/';
const USER_AGENT = 'RestSharp/106.11.7.0';
const PLANT = 'slpPlantData';
const TIMEOUT_MS = 30000;

/** Nuos operative modes (opMode) */
const MODES = {
  green: 0, comfort: 1, fast: 2, imemory: 3,
};
const MODE_NAMES = Object.fromEntries(Object.entries(MODES).map(([k, v]) => [v, k]));

/** Nuos plant settings keys */
const SETTINGS = {
  MAX_SETPOINT: 'SlpMaxSetpointTemperature',
  MAX_GREEN: 'SlpMaxGreenTemperature',
  MIN_SETPOINT: 'SlpMinSetpointTemperature',
  ANTILEGIONELLA: 'SlpAntilegionellaOnOff',
  PREHEATING: 'SlpPreHeatingOnOff',
};

/** Consumption report keys (heat pump and resistor electricity, domestic hot water) */
const CONSUMPTION = { HP: 8, RESISTOR: 9 };

class AristonError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class AristonClient {
  /**
   * @param {{ username: string, password: string, log?: Function }} options
   */
  constructor({ username, password, log }) {
    this.username = username;
    this.password = password;
    this.log = log || (() => {});
    this.token = null;
    this.loginPromise = null;
    this.queue = Promise.resolve(); // requests are serialised: the cloud dislikes bursts
    this.blockedUntil = 0; // after HTTP 429 (rate limit)
  }

  async login() {
    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const res = await this.raw('POST', 'accounts/login', { usr: this.username, pwd: this.password }, false);
        if (!res || !res.token) throw new AristonError('Login failed: no token returned', 401);
        this.token = res.token;
        return true;
      })().finally(() => { this.loginPromise = null; });
    }
    return this.loginPromise;
  }

  async raw(method, path, body, auth = true) {
    if (Date.now() < this.blockedUntil) {
      throw new AristonError('Ariston cloud rate limit: requests paused', 429);
    }
    const headers = { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (auth) headers['ar.authToken'] = this.token || '';
    const res = await fetch(API_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 429) this.blockedUntil = Date.now() + 15 * 60 * 1000;
      throw new AristonError(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** Authenticated request, serialised, with one re-login on an expired token (HTTP 401/405). */
  request(method, path, body) {
    const run = async () => {
      if (!this.token) await this.login();
      try {
        return await this.raw(method, path, body);
      } catch (err) {
        if (err.status === 401 || err.status === 405) {
          this.token = null;
          await this.login();
          return this.raw(method, path, body);
        }
        if (err.status === 404) return null;
        throw err;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Water heaters on the account ("Velis" plants). Each has gw, name, sys, wheType, wheModelType, sn. */
  async getPlants() {
    return (await this.request('GET', 'velis/plants')) || [];
  }

  /** Live state: on, mode, opMode, waterTemp, comfortTemp, reducedTemp, procReqTemp, boostOn, hpState */
  async getData(gw) {
    return (await this.request('GET', `velis/${PLANT}/${gw}`)) || {};
  }

  async getSettings(gw) {
    return (await this.request('GET', `velis/${PLANT}/${gw}/plantSettings`)) || {};
  }

  async setPower(gw, on) {
    await this.request('POST', `velis/${PLANT}/${gw}/switch`, !!on);
  }

  async setMode(gw, mode) {
    if (!(mode in MODES)) throw new Error(`Unknown mode ${mode}`);
    await this.request('POST', `velis/${PLANT}/${gw}/operativeMode`, { new: MODES[mode] });
  }

  async setTemperatures(gw, { comfort, reduced }, old) {
    await this.request('POST', `velis/${PLANT}/${gw}/temperatures`, {
      new: { comfort, reduced },
      old: { comfort: old.comfort ?? null, reduced: old.reduced ?? null },
    });
  }

  async setBoost(gw, on) {
    await this.request('POST', `velis/${PLANT}/${gw}/boost`, !!on);
  }

  async setPlantSetting(gw, key, value, oldValue) {
    await this.request('POST', `velis/${PLANT}/${gw}/plantSettings`, { [key]: { new: value, old: oldValue } });
  }

  /** Consumption sequences: [{ k: type, p: period, v: [values] }] */
  async getConsumption(gw) {
    return (await this.request('GET', `remote/reports/${gw}/consSequencesApi8?usages=DhwHeatingPumpElec%2CDhwResistorElec`)) || [];
  }
}

/**
 * Energy over the most recent reporting period (p = 1) for a consumption type, in kWh.
 * Ariston publishes hourly buckets for this period; their sum is the energy of the last day.
 */
function lastDayEnergy(sequences, type) {
  const seq = (sequences || []).find((s) => s && s.k === type && s.p === 1);
  if (!seq || !Array.isArray(seq.v)) return null;
  return Math.round(seq.v.reduce((a, b) => a + (Number(b) || 0), 0) * 100) / 100;
}

module.exports = {
  AristonClient, AristonError, MODES, MODE_NAMES, SETTINGS, CONSUMPTION, lastDayEnergy,
};
