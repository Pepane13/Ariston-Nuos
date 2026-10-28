'use strict';

/**
 * Hot water strategy, evaluated every minute. Pure logic: no I/O, so it can be unit tested.
 *
 * Rules, highest priority first:
 *  1. Anti-legionella cycle in progress (monthly, prefers strong solar production early in the
 *     month, falls back to a night in off-peak hours later in the month; ends at the done temperature)
 *  2. Manual change made from the Homey app or a Flow (kept until the next daily reset)
 *  3. Tempo red day, peak hours: no grid heating (low setpoint, boost refused) unless the sun or a
 *     full battery provides the energy
 *  4. Latched opportunity of the day, the highest one wins: solar production, full battery,
 *     night top-up in off-peak hours (preheat before a red day)
 *  5. Base setpoint
 *
 * Latched targets are cleared at the daily reset: when peak hours start and at the base time.
 */

const SOLAR_ACTIVE_W = 100; // the battery rule needs the sun to be up (battery charging from solar)
const LEGIONELLA_TIMEOUT_MS = 8 * 60 * 60 * 1000;

const DEFAULTS = {
  base_setpoint: 45,
  base_mode: 'green',
  base_time: '17:00',
  solar_enabled: true,
  solar_threshold: 500,
  solar_duration: 2,
  solar_setpoint: 52,
  solar_mode: 'green',
  battery_enabled: true,
  battery_threshold: 95,
  battery_setpoint: 55,
  battery_mode: 'comfort',
  night_enabled: true,
  night_time: '23:00',
  night_below: 50,
  night_setpoint: 52,
  night_mode: 'green',
  tempo_enabled: true,
  tempo_red_setpoint: 40,
  tempo_red_eve_setpoint: 55,
  tempo_red_allow_solar: true,
  tempo_red_block_boost: true,
  legio_enabled: true,
  legio_setpoint: 65,
  legio_done_temp: 64,
  legio_mode: 'comfort',
  legio_solar_threshold: 2000,
  legio_solar_duration: 15,
  legio_solar_days: 5,
  legio_fallback_day: 28,
  legio_fallback_time: '22:30',
  boost_max_minutes: 60,
};

function parseTime(str, fallback) {
  const m = /^(\d{1,2})[:h.](\d{2})$/.exec(String(str || '').trim());
  if (!m) return parseTime(fallback, '00:00');
  const h = Math.min(23, Number(m[1]));
  const mi = Math.min(59, Number(m[2]));
  return h * 60 + mi;
}

/**
 * Local calendar parts of a date in a time zone.
 * @returns {{ dateKey: string, monthKey: string, day: number, minutes: number }}
 */
function localParts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    monthKey: `${p.year}-${p.month}`,
    day: Number(p.day),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function emptyState() {
  return {
    latch: null, // { setpoint, mode, reason }
    manual: null, // { setpoint, mode }
    solarSince: null,
    legioSolarSince: null,
    legio: { running: false, since: null, doneMonth: null, lastDone: null },
    boostSince: null,
    lastPeriod: null,
    baseDoneDate: null,
    nightDoneDate: null,
  };
}

/** Keeps the higher of two latched targets */
function raise(current, candidate) {
  if (!current || candidate.setpoint > current.setpoint) return candidate;
  return current;
}

/**
 * @param {object} input
 * @param {number} input.now epoch ms
 * @param {string} input.timeZone
 * @param {number|null} input.water water temperature (°C)
 * @param {boolean} input.boostOn current boost state reported by the water heater
 * @param {number|null} input.solarW solar production (W)
 * @param {number|null} input.batteryPct home battery state of charge (%)
 * @param {boolean} input.evCharging the car is charging
 * @param {{ period: 'HP'|'HC'|null, today: string|null, tomorrow: string|null }} input.tariff
 * @param {object} settings device settings (DEFAULTS for missing values)
 * @param {object} prev persisted state
 * @returns {{ state: object, target: { setpoint: number, mode: string, reason: string },
 *   boost: boolean|null, events: Array<{ type: string, [k: string]: any }> }}
 */
function evaluate(input, settings, prev) {
  const s = { ...DEFAULTS, ...settings };
  const state = JSON.parse(JSON.stringify({ ...emptyState(), ...(prev || {}) }));
  state.legio = { ...emptyState().legio, ...(state.legio || {}) };
  const events = [];
  const { now } = input;
  const t = localParts(new Date(now), input.timeZone);
  const water = Number.isFinite(input.water) ? input.water : null;
  const solarW = Number.isFinite(input.solarW) ? input.solarW : 0;
  const tariff = input.tariff || {};
  let boost = null;

  // ---------- Daily reset: peak hours start, base time reached ----------
  const resetLatch = (why) => {
    if (state.latch || state.manual) events.push({ type: 'reset', why });
    state.latch = null;
    state.manual = null;
  };
  if (tariff.period && state.lastPeriod === 'HC' && tariff.period === 'HP') resetLatch('peak_hours');
  if (tariff.period) state.lastPeriod = tariff.period;
  const baseMin = parseTime(s.base_time, DEFAULTS.base_time);
  if (state.baseDoneDate === null) {
    // first run: today's base time still counts if it is ahead
    state.baseDoneDate = t.minutes >= baseMin ? t.dateKey : 'pending';
  } else if (t.minutes >= baseMin && state.baseDoneDate !== t.dateKey) {
    resetLatch('base_time');
    state.baseDoneDate = t.dateKey;
  }

  // ---------- Tempo ----------
  const tempo = s.tempo_enabled && tariff.period;
  const redPeak = !!(tempo && tariff.today === 'ROUGE' && tariff.period === 'HP');
  const redEve = !!(tempo && tariff.tomorrow === 'ROUGE');

  // ---------- Solar production held long enough ----------
  if (solarW >= s.solar_threshold) {
    if (state.solarSince === null) state.solarSince = now;
  } else {
    state.solarSince = null;
  }
  const solarHeld = state.solarSince !== null && now - state.solarSince >= s.solar_duration * 60000;
  if (s.solar_enabled && solarHeld && !input.evCharging) {
    state.latch = raise(state.latch, { setpoint: s.solar_setpoint, mode: s.solar_mode, reason: 'solar' });
  }

  // ---------- Full home battery while the sun is up ----------
  if (s.battery_enabled && Number.isFinite(input.batteryPct) && input.batteryPct >= s.battery_threshold
      && solarW >= SOLAR_ACTIVE_W && !input.evCharging) {
    state.latch = raise(state.latch, { setpoint: s.battery_setpoint, mode: s.battery_mode, reason: 'battery' });
  }

  // ---------- Night top-up (once a night, off-peak) ----------
  const nightMin = parseTime(s.night_time, DEFAULTS.night_time);
  if (t.minutes >= nightMin && state.nightDoneDate !== t.dateKey) {
    state.nightDoneDate = t.dateKey;
    const offPeak = !tariff.period || tariff.period === 'HC';
    if (offPeak && water !== null) {
      if (redEve && water < s.tempo_red_eve_setpoint) {
        state.latch = raise(state.latch, { setpoint: s.tempo_red_eve_setpoint, mode: 'comfort', reason: 'red_eve' });
      } else if (s.night_enabled && water < s.night_below) {
        state.latch = raise(state.latch, { setpoint: s.night_setpoint, mode: s.night_mode, reason: 'night' });
      }
    }
  }

  // ---------- Anti-legionella, once a month ----------
  if (s.legio_solar_threshold && solarW >= s.legio_solar_threshold) {
    if (state.legioSolarSince === null) state.legioSolarSince = now;
  } else {
    state.legioSolarSince = null;
  }
  const L = state.legio;
  if (L.running) {
    if (water !== null && water >= s.legio_done_temp) {
      L.running = false;
      L.since = null;
      L.doneMonth = t.monthKey;
      L.lastDone = t.dateKey;
      state.latch = null;
      state.manual = null;
      events.push({ type: 'legio_done', water });
    } else if (now - L.since > LEGIONELLA_TIMEOUT_MS) {
      L.running = false;
      L.since = null;
      state.latch = null;
      events.push({ type: 'legio_timeout', water });
    } else if (redPeak) {
      L.running = false; // never on peak hours of a red day: resumes at the next opportunity
      L.since = null;
      events.push({ type: 'legio_paused', water });
    }
  } else if (s.legio_enabled && L.doneMonth !== t.monthKey && !redPeak) {
    const solarOk = t.day <= s.legio_solar_days && state.legioSolarSince !== null
      && now - state.legioSolarSince >= s.legio_solar_duration * 60000;
    const fallbackOk = t.day >= s.legio_fallback_day
      && t.minutes >= parseTime(s.legio_fallback_time, DEFAULTS.legio_fallback_time)
      && (!tariff.period || tariff.period === 'HC');
    if (solarOk || fallbackOk || input.forceLegionella) {
      L.running = true;
      L.since = now;
      events.push({ type: 'legio_started', why: input.forceLegionella ? 'manual' : (solarOk ? 'solar' : 'night'), water });
    }
  }

  // ---------- Boost: time limit, refused on red peak hours ----------
  if (input.boostOn) {
    if (state.boostSince === null) state.boostSince = now;
    if (!L.running && redPeak && s.tempo_red_block_boost) {
      boost = false;
      state.boostSince = null;
      events.push({ type: 'boost_stopped', why: 'red_peak' });
    } else if (s.boost_max_minutes > 0 && now - state.boostSince >= s.boost_max_minutes * 60000) {
      boost = false;
      state.boostSince = null;
      state.latch = null;
      state.manual = null;
      events.push({ type: 'boost_stopped', why: 'timer' });
    }
  } else {
    state.boostSince = null;
  }

  // ---------- Resulting target ----------
  let target;
  if (L.running) {
    target = { setpoint: s.legio_setpoint, mode: s.legio_mode, reason: 'legionella' };
  } else if (state.manual) {
    target = { ...state.manual, reason: 'manual' };
  } else if (redPeak) {
    const free = state.latch && ['solar', 'battery'].includes(state.latch.reason) && s.tempo_red_allow_solar;
    target = free ? { ...state.latch } : { setpoint: s.tempo_red_setpoint, mode: 'green', reason: 'red_peak' };
  } else if (state.latch) {
    target = { ...state.latch };
  } else {
    target = { setpoint: s.base_setpoint, mode: s.base_mode, reason: 'base' };
  }

  return {
    state, target, boost, events,
  };
}

module.exports = {
  evaluate, emptyState, localParts, parseTime, DEFAULTS,
};
