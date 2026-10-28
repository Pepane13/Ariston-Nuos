'use strict';

const Homey = require('homey');
const { AristonClient } = require('./lib/ariston');
const { HomeSources } = require('./lib/home');

module.exports = class AristonApp extends Homey.App {
  async onInit() {
    this.clients = new Map(); // one cloud session per Ariston account, shared by its devices
    this.sources = new HomeSources(this.homey);
    this.log('Ariston Nuos app started');
  }

  /** Shared client for an account; a new password replaces the cached session */
  getClient(username, password) {
    const key = String(username || '').toLowerCase();
    let client = this.clients.get(key);
    if (!client || client.password !== password) {
      client = new AristonClient({ username, password, log: (...a) => this.log(...a) });
      this.clients.set(key, client);
    }
    return client;
  }
};
