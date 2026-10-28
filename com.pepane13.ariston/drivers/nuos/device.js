'use strict';

const Homey = require('homey');
const {
  MODES, MODE_NAMES, SETTINGS, CONSUMPTION, lastDayEnergy,
} = require('../../lib/ariston');

const SETTINGS_REFRESH_MS = 6 * 60 * 60 * 1000;
const ENERGY_REFRESH_MS = 60 * 60 * 1000;
const VERIFY_DELAY_MS = 20 * 1000; // the cloud applies a command after a few seconds
const DEFAULT_MIN = 40;
const DEFAULT_MAX = 75;

// Capabilities and store entries of the 1.0.x automatic strategy, removed in 2.0.0
const OBSOLETE_CAPABILITIES = ['ariston_automation', 'ariston_rule', 'ariston_legionella'];
const OBSOLETE_STORE = ['strategy', 'last_rule'];

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Ariston Nuos water heater. The device reads the heater state from the Ariston NET cloud
 * and executes the commands of the Homey app and Flows. It takes no decision of its own.
 */
module.exports = class NuosDevice extends Homey.Device {
  async onInit() {
    this.data = {};
    this.plantSettings = {};
    this.lastSettingsAt = 0;
    this.lastEnergyAt = 0;
    this.cloudErrors = 0;

    for (const cap of OBSOLETE_CAPABILITIES) {
      if (this.hasCapability(cap)) await this.removeCapability(cap).catch(this.error);
    }
    for (const key of OBSOLETE_STORE) {
      if (this.getStoreValue(key) !== null && this.getStoreValue(key) !== undefined) {
        await this.unsetStoreValue(key).catch(this.error);
      }
    }

    this.registerCapabilityListener('onoff', (v) => this.userSetPower(v));
    this.registerCapabilityListener('target_temperature', (v) => this.userSetTemperature(v));
    this.registerCapabilityListener('ariston_mode', (v) => this.userSetMode(v));
    this.registerCapabilityListener('ariston_boost', (v) => this.userSetBoost(v));

    this.homey.setTimeout(() => this.poll(true).catch(this.error), 3000);
    this.startPolling();
  }

  startPolling() {
    if (this.timer) this.homey.clearInterval(this.timer);
    const minutes = Math.max(1, Number(this.getSetting('poll_interval')) || 2);
    this.timer = this.homey.setInterval(() => this.poll().catch(this.error), minutes * 60000);
  }

  onDeleted() {
    if (this.timer) this.homey.clearInterval(this.timer);
  }

  onUninit() {
    if (this.timer) this.homey.clearInterval(this.timer);
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('poll_interval')) this.homey.setTimeout(() => this.startPolling(), 500);
  }

  get client() {
    return this.homey.app.getClient(this.getStoreValue('username'), this.getStoreValue('password'));
  }

  get gw() {
    return this.getData().id;
  }

  async updateCredentials(username, password) {
    await this.setStoreValue('username', username);
    await this.setStoreValue('password', password);
    await this.setAvailable();
    await this.poll(true);
  }

  // ---------------------------------------------------------------- reading

  async poll(force = false) {
    const now = Date.now();
    try {
      this.data = await this.client.getData(this.gw);
      if (force || now - this.lastSettingsAt > SETTINGS_REFRESH_MS) {
        this.plantSettings = await this.client.getSettings(this.gw);
        this.lastSettingsAt = now;
        await this.applyLimits();
      }
      if (now - this.lastEnergyAt > ENERGY_REFRESH_MS) {
        this.lastEnergyAt = now;
        await this.updateEnergy().catch((err) => this.log('Energy report unavailable:', err.message));
      }
      await this.updateCapabilities();
      if (!this.getAvailable()) await this.setAvailable();
      this.cloudErrors = 0;
    } catch (err) {
      this.cloudErrors += 1;
      this.error('Poll failed:', err.message);
      if (err.status === 401 || /login/i.test(err.message)) {
        await this.setUnavailable(this.homey.__('errors.login_repair')).catch(this.error);
      } else if (this.cloudErrors === 3) {
        await this.setUnavailable(`${this.homey.__('errors.cloud')} ${err.message}`).catch(this.error);
        this.driver.triggers.cloud_error.trigger(this, { error: err.message }).catch(this.error);
      }
    }
  }

  async applyLimits() {
    const min = Number(this.plantSettings[SETTINGS.MIN_SETPOINT]) || DEFAULT_MIN;
    const max = Number(this.plantSettings[SETTINGS.MAX_SETPOINT]) || DEFAULT_MAX;
    const opts = this.getCapabilityOptions('target_temperature') || {};
    if (opts.min !== min || opts.max !== max) {
      await this.setCapabilityOptions('target_temperature', {
        ...opts, min, max, step: 1,
      }).catch(this.error);
    }
    const info = [`min ${min} °C`, `max ${max} °C`];
    const green = Number(this.plantSettings[SETTINGS.MAX_GREEN]);
    if (green) info.push(`Green max ${green} °C`);
    await this.setSettings({ limits: info.join(' · ') }).catch(() => {});
  }

  async updateEnergy() {
    const seq = await this.client.getConsumption(this.gw);
    const hp = lastDayEnergy(seq, CONSUMPTION.HP);
    const res = lastDayEnergy(seq, CONSUMPTION.RESISTOR);
    if (hp !== null) await this.setCapabilityValue('ariston_energy.hp', hp).catch(this.error);
    if (res !== null) await this.setCapabilityValue('ariston_energy.resistor', res).catch(this.error);
  }

  async updateCapabilities() {
    const d = this.data || {};
    const set = (cap, v) => (v === undefined || v === null || !this.hasCapability(cap)
      ? null : this.setCapabilityValue(cap, v).catch(this.error));
    await set('onoff', typeof d.on === 'boolean' ? d.on : undefined);
    await set('measure_temperature', Number.isFinite(d.waterTemp) ? round1(d.waterTemp) : undefined);
    await set('target_temperature', Number.isFinite(d.comfortTemp) ? d.comfortTemp : undefined);
    await set('ariston_boost', typeof d.boostOn === 'boolean' ? d.boostOn : undefined);
    await set('ariston_heatpump', d.hpState === undefined || d.hpState === null ? undefined : !!d.hpState);
    const mode = MODE_NAMES[d.opMode];
    if (mode && mode !== this.getCapabilityValue('ariston_mode')) {
      await set('ariston_mode', mode);
      this.driver.triggers.mode_changed.trigger(this, { mode: this.homey.__(`modes.${mode}`) }).catch(this.error);
    }
  }

  /** Reads the heater again a few seconds after a command, to show what it actually took */
  verifySoon() {
    if (this.verifyTimer) this.homey.clearTimeout(this.verifyTimer);
    this.verifyTimer = this.homey.setTimeout(() => this.poll().catch(this.error), VERIFY_DELAY_MS);
  }

  // ---------------------------------------------------------------- commands

  async userSetPower(on) {
    await this.client.setPower(this.gw, on);
    this.data.on = on;
    this.verifySoon();
  }

  async userSetTemperature(value) {
    const d = this.data;
    await this.client.setTemperatures(
      this.gw,
      { comfort: value, reduced: d.reducedTemp ?? 0 },
      { comfort: d.comfortTemp, reduced: d.reducedTemp },
    );
    d.comfortTemp = value;
    this.verifySoon();
  }

  async userSetMode(mode) {
    await this.client.setMode(this.gw, mode);
    this.data.opMode = MODES[mode];
    await this.setCapabilityValue('ariston_mode', mode).catch(this.error);
    this.verifySoon();
  }

  async userSetBoost(on) {
    await this.client.setBoost(this.gw, on);
    this.data.boostOn = on;
    await this.setCapabilityValue('ariston_boost', on).catch(this.error);
    this.verifySoon();
  }
};
