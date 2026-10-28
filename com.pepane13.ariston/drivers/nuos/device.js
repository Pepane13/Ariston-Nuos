'use strict';

const Homey = require('homey');
const {
  MODES, MODE_NAMES, SETTINGS, CONSUMPTION, lastDayEnergy,
} = require('../../lib/ariston');
const { evaluate, emptyState, localParts } = require('../../lib/controller');

const TICK_MS = 60 * 1000; // strategy evaluated every minute
const SETTINGS_REFRESH_MS = 6 * 60 * 60 * 1000;
const ENERGY_REFRESH_MS = 60 * 60 * 1000;
const RESEND_AFTER_MS = 10 * 60 * 1000; // a command the heater did not take is sent again after 10 min at most
const VERIFY_DELAY_MS = 20 * 1000; // the cloud applies a command after a few seconds
const DEFAULT_MIN = 40;
const DEFAULT_MAX = 75;

const round1 = (v) => Math.round(v * 10) / 10;

module.exports = class NuosDevice extends Homey.Device {
  async onInit() {
    this.data = {};
    this.plantSettings = {};
    this.lastSettingsAt = 0;
    this.lastEnergyAt = 0;
    this.lastPollAt = 0;
    this.lastCommand = {}; // { key: { value, at } }
    this.state = { ...emptyState(), ...(this.getStoreValue('strategy') || {}) };
    this.lastRule = this.getStoreValue('last_rule') || null;
    this.forceLegionella = false;

    if (!this.hasCapability('ariston_automation')) await this.addCapability('ariston_automation');
    if (this.getCapabilityValue('ariston_automation') === null) await this.setCapabilityValue('ariston_automation', true);

    this.registerCapabilityListener('onoff', (v) => this.userSetPower(v));
    this.registerCapabilityListener('target_temperature', (v) => this.userSetTemperature(v));
    this.registerCapabilityListener('ariston_mode', (v) => this.userSetMode(v));
    this.registerCapabilityListener('ariston_boost', (v) => this.userSetBoost(v));
    this.registerCapabilityListener('ariston_automation', (v) => this.setAutomation(v, true));

    await this.updateLegioCapability();
    this.homey.setTimeout(() => this.tick().catch(this.error), 3000);
    this.timer = this.homey.setInterval(() => this.tick().catch(this.error), TICK_MS);
  }

  onDeleted() {
    if (this.timer) this.homey.clearInterval(this.timer);
  }

  onUninit() {
    if (this.timer) this.homey.clearInterval(this.timer);
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

  // ---------------------------------------------------------------- polling

  async poll(force = false) {
    const interval = Math.max(1, Number(this.getSetting('poll_interval')) || 2) * 60000;
    const now = Date.now();
    if (!force && now - this.lastPollAt < interval - 5000) return;
    this.lastPollAt = now;
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
      this.cloudErrors = (this.cloudErrors || 0) + 1;
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
      await this.setCapabilityOptions('target_temperature', { ...opts, min, max, step: 1 }).catch(this.error);
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

  // ---------------------------------------------------------------- strategy

  async tick() {
    await this.poll();
    if (!this.data || Object.keys(this.data).length === 0) return;

    let home = {
      solarW: null, batteryPct: null, evCharging: false, tariff: {},
    };
    try {
      home = await this.homey.app.sources.read();
      if (home.errors && home.errors.length) this.log('Source warning:', home.errors.join('; '));
    } catch (err) {
      this.error('Reading Homey devices failed:', err.message);
    }

    const result = evaluate({
      now: Date.now(),
      timeZone: this.homey.clock.getTimezone(),
      water: this.data.waterTemp,
      boostOn: this.data.boostOn === true,
      solarW: home.solarW,
      batteryPct: home.batteryPct,
      evCharging: home.evCharging,
      tariff: home.tariff,
      forceLegionella: this.forceLegionella,
    }, this.getSettings(), this.state);
    this.forceLegionella = false;

    await this.saveState(result.state);
    for (const ev of result.events) await this.handleEvent(ev);

    const auto = this.getCapabilityValue('ariston_automation') !== false;
    if (result.target.reason !== this.lastRule) {
      this.lastRule = result.target.reason;
      await this.setStoreValue('last_rule', this.lastRule);
      if (auto) {
        this.log(`Rule ${result.target.reason}: ${result.target.setpoint} °C ${result.target.mode}`);
        this.driver.triggers.rule_changed.trigger(this, {
          rule: this.homey.__(`rules.${result.target.reason}`), setpoint: result.target.setpoint,
        }).catch(this.error);
      }
    }
    await this.setCapabilityValue('ariston_rule', auto
      ? `${this.homey.__(`rules.${result.target.reason}`)} · ${result.target.setpoint} °C`
      : this.homey.__('rules.paused')).catch(this.error);

    if (!auto || this.data.on === false) return;
    await this.apply(result.target, result.boost);
  }

  async saveState(state) {
    const json = JSON.stringify(state);
    if (json === this.stateJson) return;
    const legioChanged = !this.state || JSON.stringify(this.state.legio) !== JSON.stringify(state.legio);
    this.state = state;
    this.stateJson = json;
    await this.setStoreValue('strategy', state).catch(this.error);
    if (legioChanged) await this.updateLegioCapability();
  }

  async updateLegioCapability() {
    const last = this.state.legio && this.state.legio.lastDone;
    let text = last ? last.split('-').reverse().join('/') : '—';
    if (this.state.legio && this.state.legio.running) text = this.homey.__('legio.running');
    await this.setCapabilityValue('ariston_legionella', text).catch(this.error);
  }

  /** Sends what differs between the target and the heater, without repeating a command too often */
  async apply(target, boost) {
    const d = this.data;
    let { setpoint, mode } = target;
    const min = Number(this.plantSettings[SETTINGS.MIN_SETPOINT]) || DEFAULT_MIN;
    const max = Number(this.plantSettings[SETTINGS.MAX_SETPOINT]) || DEFAULT_MAX;
    const green = Number(this.plantSettings[SETTINGS.MAX_GREEN]);
    setpoint = Math.min(max, Math.max(min, setpoint));
    // Green (heat pump only) cannot go above its own maximum: keep the temperature, use Comfort
    if (mode === 'green' && green && setpoint > green) mode = 'comfort';
    // A manual change was already sent by the user: only the boost limits still apply
    const manual = target.reason === 'manual';

    let sent = false;
    try {
      if (boost === false && d.boostOn) {
        sent = await this.send('boost', false, () => this.client.setBoost(this.gw, false)) || sent;
      }
      if (!manual && MODE_NAMES[d.opMode] !== mode) {
        sent = await this.send('mode', mode, () => this.client.setMode(this.gw, mode)) || sent;
      }
      if (!manual && d.comfortTemp !== setpoint) {
        sent = await this.send('setpoint', setpoint, () => this.client.setTemperatures(
          this.gw,
          { comfort: setpoint, reduced: d.reducedTemp ?? 0 },
          { comfort: d.comfortTemp, reduced: d.reducedTemp },
        )) || sent;
      }
    } catch (err) {
      this.error('Command failed:', err.message);
    }
    if (sent) this.homey.setTimeout(() => this.poll(true).catch(this.error), VERIFY_DELAY_MS);
  }

  async send(key, value, fn) {
    const last = this.lastCommand[key];
    if (last && last.value === value && Date.now() - last.at < RESEND_AFTER_MS) return false;
    this.log(`Command ${key} = ${value}`);
    this.lastCommand[key] = { value, at: Date.now() };
    await fn();
    return true;
  }

  async handleEvent(ev) {
    const water = Number.isFinite(ev.water) ? round1(ev.water) : 0;
    const notify = (key, tokens = {}) => {
      if (this.getSetting('notifications') === false) return;
      let text = this.homey.__(key);
      for (const [k, v] of Object.entries(tokens)) text = text.replace(`{{${k}}}`, v);
      this.homey.notifications.createNotification({ excerpt: `${this.getName()} : ${text}` }).catch(this.error);
    };
    this.log('Event', JSON.stringify(ev));
    switch (ev.type) {
      case 'legio_started':
        notify('notify.legio_started', { why: this.homey.__(`legio.why_${ev.why}`), temp: water });
        await this.driver.triggers.legionella_started.trigger(this, { temperature: water }).catch(this.error);
        break;
      case 'legio_done':
        notify('notify.legio_done', { temp: water });
        await this.driver.triggers.legionella_done.trigger(this, { temperature: water }).catch(this.error);
        break;
      case 'legio_timeout':
        notify('notify.legio_timeout', { temp: water });
        break;
      case 'legio_paused':
        notify('notify.legio_paused', { temp: water });
        break;
      case 'boost_stopped':
        notify(`notify.boost_${ev.why}`, { temp: round1(this.data.waterTemp || 0) });
        await this.driver.triggers.boost_stopped.trigger(this, {
          reason: this.homey.__(`notify.boost_reason_${ev.why}`),
          temperature: round1(this.data.waterTemp || 0),
        }).catch(this.error);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- user actions

  currentRule() {
    return this.lastRule;
  }

  legionellaDoneThisMonth() {
    const month = localParts(new Date(), this.homey.clock.getTimezone()).monthKey;
    return !!(this.state.legio && this.state.legio.doneMonth === month);
  }

  /** A manual change is kept until the next daily reset (peak hours start or base time) */
  async setManual(patch) {
    const current = this.state.manual || {
      setpoint: this.data.comfortTemp ?? this.getCapabilityValue('target_temperature'),
      mode: MODE_NAMES[this.data.opMode] || 'green',
    };
    await this.saveState({ ...this.state, manual: { ...current, ...patch } });
    this.lastCommand = {};
  }

  async userSetPower(on) {
    await this.client.setPower(this.gw, on);
    this.data.on = on;
  }

  async userSetTemperature(value) {
    const d = this.data;
    await this.client.setTemperatures(
      this.gw,
      { comfort: value, reduced: d.reducedTemp ?? 0 },
      { comfort: d.comfortTemp, reduced: d.reducedTemp },
    );
    d.comfortTemp = value;
    await this.setManual({ setpoint: value });
  }

  async userSetMode(mode) {
    await this.client.setMode(this.gw, mode);
    await this.setManual({ mode });
    this.data.opMode = MODES[mode];
    await this.setCapabilityValue('ariston_mode', mode).catch(this.error);
  }

  async userSetBoost(on) {
    await this.client.setBoost(this.gw, on);
    this.data.boostOn = on;
    await this.setCapabilityValue('ariston_boost', on).catch(this.error);
  }

  async setAutomation(on, fromCapability = false) {
    if (!fromCapability) await this.setCapabilityValue('ariston_automation', on);
    this.lastCommand = {};
    if (on) this.homey.setTimeout(() => this.tick().catch(this.error), 1000);
  }

  async startLegionella() {
    const legio = { ...this.state.legio, doneMonth: null };
    await this.saveState({ ...this.state, legio });
    this.forceLegionella = true;
    await this.tick();
  }

  async resumeStrategy() {
    await this.saveState({ ...this.state, manual: null });
    this.lastCommand = {};
    await this.tick();
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.some((k) => k !== 'poll_interval')) {
      this.lastCommand = {};
      this.homey.setTimeout(() => this.tick().catch(this.error), 1000);
    }
  }
};
