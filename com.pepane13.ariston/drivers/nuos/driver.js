'use strict';

const Homey = require('homey');

const NUOS_WHE_TYPE = 4; // python-ariston-api WheType.NuosSplit

module.exports = class NuosDriver extends Homey.Driver {
  async onInit() {
    const f = this.homey.flow;
    this.triggers = {
      rule_changed: f.getDeviceTriggerCard('rule_changed'),
      mode_changed: f.getDeviceTriggerCard('mode_changed'),
      legionella_started: f.getDeviceTriggerCard('legionella_started'),
      legionella_done: f.getDeviceTriggerCard('legionella_done'),
      boost_stopped: f.getDeviceTriggerCard('boost_stopped'),
      cloud_error: f.getDeviceTriggerCard('cloud_error'),
    };

    f.getConditionCard('mode_is').registerRunListener(({ device, mode }) => device.getCapabilityValue('ariston_mode') === mode);
    f.getConditionCard('boost_on').registerRunListener(({ device }) => device.getCapabilityValue('ariston_boost') === true);
    f.getConditionCard('heatpump_running').registerRunListener(({ device }) => device.getCapabilityValue('ariston_heatpump') === true);
    f.getConditionCard('automation_on').registerRunListener(({ device }) => device.getCapabilityValue('ariston_automation') === true);
    f.getConditionCard('rule_is').registerRunListener(({ device, rule }) => device.currentRule() === rule);
    f.getConditionCard('legionella_done_month').registerRunListener(({ device }) => device.legionellaDoneThisMonth());

    f.getActionCard('set_mode').registerRunListener(({ device, mode }) => device.userSetMode(mode));
    f.getActionCard('set_boost').registerRunListener(({ device, state }) => device.userSetBoost(state === 'on'));
    f.getActionCard('set_automation').registerRunListener(({ device, state }) => device.setAutomation(state === 'on'));
    f.getActionCard('start_legionella').registerRunListener(({ device }) => device.startLegionella());
    f.getActionCard('resume_strategy').registerRunListener(({ device }) => device.resumeStrategy());
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
