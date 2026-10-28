'use strict';

const Homey = require('homey');

const NUOS_WHE_TYPE = 4; // python-ariston-api WheType.NuosSplit

module.exports = class NuosDriver extends Homey.Driver {
  async onInit() {
    const f = this.homey.flow;
    this.triggers = {
      mode_changed: f.getDeviceTriggerCard('mode_changed'),
      cloud_error: f.getDeviceTriggerCard('cloud_error'),
    };

    f.getConditionCard('mode_is').registerRunListener(({ device, mode }) => device.getCapabilityValue('ariston_mode') === mode);
    f.getConditionCard('boost_on').registerRunListener(({ device }) => device.getCapabilityValue('ariston_boost') === true);
    f.getConditionCard('heatpump_running').registerRunListener(({ device }) => device.getCapabilityValue('ariston_heatpump') === true);

    f.getActionCard('set_mode').registerRunListener(({ device, mode }) => device.userSetMode(mode));
    f.getActionCard('set_boost').registerRunListener(({ device, state }) => device.userSetBoost(state === 'on'));
    f.getActionCard('refresh').registerRunListener(({ device }) => device.poll(true));

    this.log('Nuos driver initialised');
  }

  async onPair(session) {
    let username = '';
    let password = '';

    session.setHandler('login', async (data) => {
      username = String(data.username || '').trim();
      password = String(data.password || '');
      const client = this.homey.app.getClient(username, password);
      try {
        await client.login();
        return true;
      } catch (err) {
        this.error('Login failed:', err.message);
        throw new Error(this.homey.__('errors.login'));
      }
    });

    session.setHandler('list_devices', async () => {
      const client = this.homey.app.getClient(username, password);
      const plants = await client.getPlants();
      this.log(`Account has ${plants.length} water heater(s):`, plants.map((p) => `${p.name} sys=${p.sys} wheType=${p.wheType}`).join(', '));
      return plants
        .filter((p) => p && p.gw)
        .map((p) => ({
          name: p.name || 'Ariston Nuos',
          data: { id: p.gw },
          store: {
            username, password, wheType: p.wheType, model: p.wheModelType,
          },
          settings: { gateway: p.gw, whe_type: p.wheType === NUOS_WHE_TYPE ? 'Nuos' : `wheType ${p.wheType}` },
        }));
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async (data) => {
      const username = String(data.username || '').trim();
      const password = String(data.password || '');
      const client = this.homey.app.getClient(username, password);
      try {
        await client.login();
      } catch (err) {
        throw new Error(this.homey.__('errors.login'));
      }
      await device.updateCredentials(username, password);
      return true;
    });
  }
};
