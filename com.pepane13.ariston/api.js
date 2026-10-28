'use strict';

/** Web API used by the app settings page (settings/index.html) */
module.exports = {
  async getSources({ homey }) {
    const candidates = await homey.app.sources.candidates();
    const selected = {
      solar: homey.settings.get('source_solar') || '',
      battery: homey.settings.get('source_battery') || '',
      ev: homey.settings.get('source_ev') || '',
      linky: homey.settings.get('source_linky') || '',
    };
    let readings = null;
    try {
      readings = await homey.app.sources.read();
    } catch (err) {
      readings = { error: err.message };
    }
    return { candidates, selected, readings };
  },

  async setSources({ homey, body }) {
    for (const role of ['solar', 'battery', 'ev', 'linky']) {
      if (body && typeof body[role] === 'string') homey.settings.set(`source_${role}`, body[role]);
    }
    return homey.app.sources.read();
  },
};
