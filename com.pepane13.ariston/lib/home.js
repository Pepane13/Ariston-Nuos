'use strict';

const { HomeyAPI } = require('homey-api');

/**
 * Reads the other Homey devices the strategy depends on (solar inverter, home battery,
 * EV charger, Linky meter), chosen in the app settings. Requires the homey:manager:api permission.
 */

const ROLES = {
  solar: { capability: 'measure_power', label: { en: 'Solar production', fr: 'Production solaire' } },
  battery: { capability: 'measure_battery', label: { en: 'Home battery', fr: 'Batterie domestique' } },
  ev: { capability: ['evcharger_charging_state', 'measure_evse_state'], label: { en: 'EV charger', fr: 'Borne de recharge' } },
  linky: { capability: ['price_period_capability', 'today_color_capability'], label: { en: 'Linky meter (Tempo)', fr: 'Compteur Linky (Tempo)' } },
};

const COLORS = ['BLEU', 'BLANC', 'ROUGE'];

function value(device, cap) {
  const c = device && device.capabilitiesObj && device.capabilitiesObj[cap];
  return c ? c.value : undefined;
}

function normColor(v) {
  const s = String(v || '').toUpperCase();
  return COLORS.find((c) => s.includes(c)) || null;
}

function normPeriod(v) {
  const s = String(v || '').toUpperCase();
  if (s.startsWith('HP')) return 'HP';
  if (s.startsWith('HC')) return 'HC';
  return null;
}

class HomeSources {
  constructor(homey) {
    this.homey = homey;
    this.api = null;
  }

  async getApi() {
    if (!this.api) this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    return this.api;
  }

  /** Devices usable for each role, for the settings page */
  async candidates() {
    const api = await this.getApi();
    const devices = Object.values(await api.devices.getDevices());
    const out = {};
    for (const [role, def] of Object.entries(ROLES)) {
      const caps = [].concat(def.capability);
      out[role] = devices
        .filter((d) => caps.some((c) => (d.capabilities || []).includes(c)))
        .map((d) => ({ id: d.id, name: d.name, zone: d.zoneName || '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }

  /** Current readings; a missing or unavailable source gives null values */
  async read() {
    const ids = {
      solar: this.homey.settings.get('source_solar'),
      battery: this.homey.settings.get('source_battery'),
      ev: this.homey.settings.get('source_ev'),
      linky: this.homey.settings.get('source_linky'),
    };
    const result = {
      solarW: null, batteryPct: null, evCharging: false, tariff: { period: null, today: null, tomorrow: null }, errors: [],
    };
    if (!Object.values(ids).some(Boolean)) return result;
    const api = await this.getApi();
    const get = async (role) => {
      if (!ids[role]) return null;
      try {
        return await api.devices.getDevice({ id: ids[role] });
      } catch (err) {
        result.errors.push(`${role}: ${err.message}`);
        return null;
      }
    };
    const [solar, battery, ev, linky] = await Promise.all(['solar', 'battery', 'ev', 'linky'].map(get));
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    result.solarW = num(value(solar, 'measure_power'));
    result.batteryPct = num(value(battery, 'measure_battery'));
    if (ev) {
      const state = value(ev, 'evcharger_charging_state');
      const evse = num(value(ev, 'measure_evse_state'));
      result.evCharging = state !== undefined && state !== null
        ? state === 'plugged_in_charging'
        : evse !== null && evse >= 4;
    }
    if (linky) {
      result.tariff = {
        period: normPeriod(value(linky, 'price_period_capability')),
        today: normColor(value(linky, 'today_color_capability')),
        tomorrow: normColor(value(linky, 'tomorrow_color_capability')),
      };
    }
    return result;
  }
}

module.exports = {
  HomeSources, ROLES, normColor, normPeriod,
};
