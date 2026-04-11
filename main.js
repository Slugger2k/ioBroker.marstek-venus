'use strict';

const utils = require('@iobroker/adapter-core');
const dgram = require('node:dgram');
const { RateLimitQueue } = require('./lib/request-queue');

class MarstekVenusAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'marstek-venus',
        });

        this.socket = null;
        this.requestId = 1;
        this.pendingRequests = new Map();
        this.pendingRequestsByMethod = new Map();
        this._requestQueue = null;
        this.pollInterval = null;
        this.slowPollInterval = null;
        this.fastPollInterval = null;
        this.discoveredIP = null;
        this._pollingInProgress = false;
        this._pollFailureCount = 0;

        this.on('ready', () => this.onReady());
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
        this.on('unload', (callback) => this.onUnload(callback));
        this.on('message', (obj) => this.onMessage(obj));
    }

    async onReady() {
        this.log.info('Starting Marstek Venus adapter');

        await this.initStates();

        this.socket = dgram.createSocket('udp4');

        this.socket.on('error', (err) => {
            this.log.error(`UDP socket error: ${err.message}`);
        });

        this.socket.on('message', this.handleResponse.bind(this));

        this.socket.bind(0, () => {
            this.socket.setBroadcast(true);
            const address = this.socket.address();
            this.log.debug(`UDP socket bound successfully to ${address.address}:${address.port}`);

            this._requestQueue = new RateLimitQueue({ intervalMs: 250 });

            if (this.config.autoDiscovery && !this.config.ipAddress) {
                this.discoverDevices().catch(err => this.log.error(`Discovery failed: ${err.message}`));
            } else if (this.config.ipAddress) {
                this.log.info(`Using configured device: ${this.config.ipAddress}:${this.config.udpPort}`);
                this.startPolling();
            } else {
                this.log.warn('No device configured and auto-discovery disabled');
            }
        });
    }

    async sendRequest(method, params = {}) {
        if (!this._requestQueue) {
            this.log.error('sendRequest: Request queue not initialized');
            throw new Error('Request queue not initialized');
        }

        const targetIP = this.discoveredIP || this.config.ipAddress;

        if (!targetIP) {
            this.log.error(`sendRequest ${method}: No target IP configured`);
            throw new Error(`No target IP configured`);
        }

        this.pendingRequestsByMethod = this.pendingRequestsByMethod || new Map();

        const PLACEHOLDER = Symbol('pending');

        const existing = this.pendingRequestsByMethod.get(method);
        if (existing === PLACEHOLDER) {
            return new Promise((resolve, reject) => {
                let attempts = 0;
                const checkInterval = setInterval(() => {
                    const updated = this.pendingRequestsByMethod.get(method);
                    if (updated && updated !== PLACEHOLDER) {
                        clearInterval(checkInterval);
                        resolve(updated);
                    } else if (!this.pendingRequestsByMethod.has(method)) {
                        clearInterval(checkInterval);
                        reject(new Error(`Request ${method} failed before completion`));
                    }
                    attempts++;
                    if (attempts > 500) {
                        clearInterval(checkInterval);
                        reject(new Error(`Request ${method} wait timeout`));
                    }
                }, 20);
            });
        }

        if (existing) {
            this.log.debug(`Request ${method} already pending, reusing existing promise`);
            return existing;
        }

        this.pendingRequestsByMethod.set(method, PLACEHOLDER);

        const maxRetries = this.config.maxRetries || 1;
        const timeoutMs = this.config.requestTimeout || 2000;
        const id = this.requestId++;
        const request = { id, method, params };
        const message = Buffer.from(JSON.stringify(request));

        const promise = this._requestQueue.enqueue(() => new Promise((resolve, reject) => {
            let retryCount = 0;

            const sendOnce = () => {
                const timeout = setTimeout(() => {
                    const pending = this.pendingRequests.get(id);
                    if (!pending) return;

                    retryCount++;
                    if (retryCount < maxRetries) {
                        this.log.debug(`Retry ${retryCount}/${maxRetries} for ${method}`);
                        sendOnce();
                    } else {
                        this.pendingRequests.delete(id);
                        this.pendingRequestsByMethod.delete(method);
                        this.log.warn(`sendRequest ${method} failed after ${maxRetries} attempts`);
                        reject(new Error(`Request ${method} timed out after ${maxRetries} attempts`));
                    }
                }, timeoutMs);

                this.pendingRequests.set(id, { resolve, reject, timeout, method });

                this.log.debug(`Sending ${method} to ${targetIP}:${this.config.udpPort} (attempt ${retryCount + 1}/${maxRetries})`);
                this.socket.send(message, 0, message.length, this.config.udpPort, targetIP, (err) => {
                    if (err) {
                        clearTimeout(timeout);
                        this.pendingRequests.delete(id);
                        this.pendingRequestsByMethod.delete(method);
                        this.log.error(`sendRequest ${method} to ${targetIP} send error: ${err.message}`);
                        reject(err);
                    }
                });
            };

            sendOnce();
        }));

        this.pendingRequestsByMethod.set(method, promise);
        return promise;
    }

    handleResponse(msgBuffer, rinfo) {
        try {
            const response = JSON.parse(msgBuffer.toString());
            this.log.debug(`Received response from ${rinfo.address}:${rinfo.port}: ${JSON.stringify(response)}`);

            if (response.id !== undefined && this.pendingRequests.has(response.id)) {
                const pending = this.pendingRequests.get(response.id);
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(response.id);
                if (pending.method) {
                    this.pendingRequestsByMethod?.delete(pending.method);
                }

                if (response.error) {
                    pending.reject(new Error(`API Error ${response.error.code}: ${response.error.message}`));
                    this.log.debug(`Request ${response.id} failed: ${response.error.message}`);
                } else {
                    const resultValue = response.result;
                    pending.resolve(resultValue);
                    this.log.debug(`Request ${response.id} succeeded`);
                    pending.timeout = null;
                    pending.resolve = undefined;
                    pending.reject = undefined;
                }
            } else if (response.result && response.result.device) {
                this.log.info(`Discovered device: ${response.result.device} at ${response.result.ip}`);
                this.log.debug(`Device details: ${JSON.stringify(response.result)}`);

                if (response.result && response.result.ip) {
                    if (!this.config.ipAddress) {
                        this.discoveredIP = response.result.ip;
                        this.log.info(`Auto-selecting discovered device: ${this.discoveredIP}`);
                        this.startPolling();
                        this.setStateAsync('info.device', { val: response.result.device, ack: true });
                        this.setStateAsync('info.firmware', { val: response.result.ver, ack: true });
                        this.setStateAsync('info.mac', { val: response.result.ble_mac || response.result.wifi_mac, ack: true });
                    } else {
                        this.log.info(`Device discovered but using configured IP: ${this.config.ipAddress}`);
                    }
                } else {
                    this.log.warn(`Received discovery response without IP address: ${JSON.stringify(response.result)}`);
                }
            } else {
                this.log.debug(`Received unsolicited message: ${response.method}`);
            }
        } catch (e) {
            this.log.debug(`Invalid response received: ${e.message}`);
            this.log.debug(`Raw message: ${msgBuffer.toString()}`);
            this.log.debug(`From: ${rinfo.address}:${rinfo.port}`);
        }
    }

    startFastPolling() {
        this.log.info(`Starting fast polling loop (every ${this.config.fastPollInterval || 1000}ms)`);
        this.fastPollInterval = setInterval(() => this.pollPower(), this.config.fastPollInterval || 1000);
        this.pollPower();
    }

    startPolling() {
        this.log.info('Starting polling loop');
        this.pollInterval = setInterval(() => this.poll(), this.config.pollInterval || 10000);
        this.startFastPolling();
        this.startSlowPolling();
        this.poll();
    }

    startSlowPolling() {
        this.log.info('Starting slow polling loop (info + network every 10 min)');
        this.slowPollInterval = setInterval(() => this.pollSlow(), 600000);
        this.pollSlow();
    }

    async onMessage(obj) {
        if (obj.command === 'discover') {
            await this.discoverDevices();
            if (obj.callback) this.sendTo(obj.from, obj.command, {
                success: !!this.discoveredIP,
                ipAddress: this.discoveredIP || null
            }, obj.callback);
        } else if (obj.command === 'setSettings') {
            const settings = obj.values;
            this.config.autoDiscovery = settings.autoDiscovery;
            this.config.ipAddress = settings.ipAddress;
            this.config.udpPort = settings.udpPort;
            this.config.pollInterval = settings.pollInterval;

            await this.setObject('system.adapter.marstek-venus.0', {
                type: 'instance',
                native: {
                    autoDiscovery: settings.autoDiscovery,
                    ipAddress: settings.ipAddress,
                    udpPort: settings.udpPort,
                    pollInterval: settings.pollInterval
                }
            });

            this.log.info('Settings saved and persisted');

            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { success: true }, obj.callback);
            }
        } else if (obj.command === 'getSettings') {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, {
                    values: {
                        autoDiscovery: this.config.autoDiscovery,
                        ipAddress: this.config.ipAddress,
                        udpPort: this.config.udpPort,
                        pollInterval: this.config.pollInterval
                    }
                }, obj.callback);
            }
        }
    }

    onUnload(callback) {
        try {
            this.log.info('Shutting down Marstek Venus adapter');

            if (this.pollInterval) clearInterval(this.pollInterval);
            if (this.slowPollInterval) clearInterval(this.slowPollInterval);
            if (this.fastPollInterval) clearInterval(this.fastPollInterval);
            if (this._requestQueue) this._requestQueue.clear();
            if (this.socket) this.socket.close();

            for (const [id, pending] of this.pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Adapter shutting down'));
                this.pendingRequests.delete(id);
            }

            callback();
        } catch (e) {
            callback();
        }
    }
}

const { Adapter: AdapterMixin } = require('./lib/adapter');
const { Polling } = require('./lib/polling');
const { Control } = require('./lib/control');
const { Discovery } = require('./lib/discovery');

Object.assign(MarstekVenusAdapter.prototype, utils.Adapter.prototype);

// Helper function to copy methods from mixin to prototype
function copyMethods(target, source) {
    if (!source) return;
    if (source.prototype && Object.getPrototypeOf(source.prototype)) {
        // It's a class - copy from prototype
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source.prototype));
    } else {
        // It's a plain object - copy directly
        Object.assign(target, source);
    }
}

if (AdapterMixin) copyMethods(MarstekVenusAdapter.prototype, AdapterMixin);
if (Polling) copyMethods(MarstekVenusAdapter.prototype, Polling);
if (Control) copyMethods(MarstekVenusAdapter.prototype, Control);
if (Discovery) copyMethods(MarstekVenusAdapter.prototype, Discovery);

// Export both the class and the factory
module.exports = MarstekVenusAdapter;
module.exports.createAdapter = (options) => new MarstekVenusAdapter(options);

if (!module.parent) {
    new MarstekVenusAdapter();
}