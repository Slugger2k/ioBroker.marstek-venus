"use strict";

const utils = require("@iobroker/adapter-core");
const dgram = require("node:dgram");
const { RateLimitQueue } = require("./lib/request-queue");
const { Polling } = require("./lib/polling");
const { Control } = require("./lib/control");
const { Discovery } = require("./lib/discovery");
const { Adapter: AdapterMixin } = require("./lib/adapter");
const {
	DEFAULT_FAST_POLL_INTERVAL,
	DEFAULT_POLL_INTERVAL,
	DEFAULT_SLOW_POLL_INTERVAL,
	DEFAULT_REQUEST_TIMEOUT,
	DEFAULT_MAX_RETRIES,
	REQUEST_ID_WRAP,
} = require("./lib/constants");

/**
 *
 */
class MarstekVenusAdapter extends utils.Adapter {
	/**
	 *
	 * @param options
	 */
	constructor(options = {}) {
		super({
			...options,
			name: "marstek-venus",
		});

		this._socket = null;
		this._requestId = 1;
		this._pendingRequests = new Map();
		this._pendingRequestsByMethod = new Map();
		this._requestQueue = null;
		this._normalPollTimer = null;
		this._slowPollTimer = null;
		this._fastPollTimer = null;
		this._discoveredIP = null;
		this._discoveredDeviceModel = null;
		this._pollingInProgress = false;
		this._slowPollingInProgress = false;
		this._pollFailureCount = 0;

		this.on("ready", () => this.onReady());
		this.on("stateChange", (id, state) => this.onStateChange(id, state));
		this.on("unload", callback => this.onUnload(callback));
		this.on("message", obj => this.onMessage(obj));
	}

	/**
	 *
	 */
	async onReady() {
		this.log.info("Starting Marstek Venus adapter");

		await this.initStates();

		this._socket = dgram.createSocket("udp4");

		this._socket.on("error", err => {
			this.log.error(`UDP socket error: ${err.message}`);
			this.recreateSocket();
		});

		this._socket.on("message", this.handleResponse.bind(this));

		this._socket.bind(0, () => {
			this._socket.setBroadcast(true);
			const address = this._socket.address();
			this.log.debug(`UDP socket bound successfully to ${address.address}:${address.port}`);

			this._requestQueue = new RateLimitQueue({ intervalMs: 250, adapter: this });

			if (this.config.autoDiscovery && !this.config.ipAddress) {
				this.discoverDevices().catch(err => this.log.error(`Discovery failed: ${err.message}`));
			} else if (this.config.ipAddress) {
				this.log.info(`Using configured device: ${this.config.ipAddress}:${this.config.udpPort}`);
				this.startPolling();
			} else {
				this.log.warn("No device configured and auto-discovery disabled");
			}
		});
	}

	/**
	 *
	 */
	recreateSocket() {
		if (this._socket) {
			try {
				this._socket.close();
			} catch (e) {
				this.log.debug(`Error closing socket: ${e.message}`);
			}
		}

		this._socket = dgram.createSocket("udp4");

		this._socket.on("error", err => {
			this.log.error(`UDP socket error: ${err.message}`);
			this.recreateSocket();
		});

		this._socket.on("message", this.handleResponse.bind(this));

		this._socket.bind(0, () => {
			this._socket.setBroadcast(true);
			const address = this._socket.address();
			this.log.debug(`UDP socket recreated and bound to ${address.address}:${address.port}`);
		});
	}

	/**
	 *
	 * @param method
	 * @param params
	 */
	async sendRequest(method, params = {}) {
		if (!this._requestQueue) {
			this.log.error("sendRequest: Request queue not initialized");
			throw new Error("Request queue not initialized");
		}

		const targetIP = this._discoveredIP || this.config.ipAddress;

		if (!targetIP) {
			this.log.error(`sendRequest ${method}: No target IP configured`);
			throw new Error(`No target IP configured`);
		}

		this._pendingRequestsByMethod = this._pendingRequestsByMethod || new Map();

		const existing = this._pendingRequestsByMethod.get(method);
		if (existing) {
			this.log.debug(`Request ${method} already pending, reusing existing promise`);
			return existing;
		}

		const timeoutMs = this.config.requestTimeout || DEFAULT_REQUEST_TIMEOUT;
		const id = this._requestId++;
		if (this._requestId > REQUEST_ID_WRAP) {
			this._requestId = 1;
		}
		const request = { id, method, params };
		const message = Buffer.from(JSON.stringify(request));

		const promise = this._requestQueue.enqueue(
			() =>
				new Promise((resolve, reject) => {
					const timeout = this.setTimeout(() => {
						this._pendingRequests.delete(id);
						this._pendingRequestsByMethod.delete(method);
						this.log.warn(`sendRequest ${method} timed out after ${timeoutMs}ms`);
						reject(new Error(`Request ${method} timed out`));
					}, timeoutMs);

					this._pendingRequests.set(id, { resolve, reject, timeout, method });

					this.log.debug(`Sending ${method} to ${targetIP}:${this.config.udpPort}`);
					this.log.silly(`Request: ${message.toString()}`);
					this._socket.send(message, 0, message.length, this.config.udpPort, targetIP, err => {
						if (err) {
							this.clearTimeout(timeout);
							this._pendingRequests.delete(id);
							this._pendingRequestsByMethod.delete(method);
							this.log.error(`sendRequest ${method} to ${targetIP} send error: ${err.message}`);
							reject(err);
						}
					});
				}),
		);

		this._pendingRequestsByMethod.set(method, promise);
		return promise;
	}

	/**
	 * Send a request with retries (for control/write commands).
	 * Each retry goes through the rate-limit queue.
	 *
	 * @param method
	 * @param params
	 * @param maxRetries
	 */
	async sendRequestWithRetry(method, params = {}, maxRetries) {
		const retries = maxRetries !== undefined ? maxRetries : this.config.maxRetries || DEFAULT_MAX_RETRIES;
		let lastError;
		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				return await this.sendRequest(method, params);
			} catch (err) {
				lastError = err;
				if (attempt < retries - 1) {
					const delay = 500 * Math.pow(2, attempt);
					this.log.debug(`Retry ${attempt + 1}/${retries} for ${method} in ${delay}ms`);
					await new Promise(resolve => this.setTimeout(resolve, delay));
				}
			}
		}
		throw lastError;
	}

	/**
	 *
	 * @param msgBuffer
	 * @param rinfo
	 */
	handleResponse(msgBuffer, rinfo) {
		try {
			this.log.silly(`Response from ${rinfo.address}:${rinfo.port}: ${msgBuffer.toString()}`);
			const response = JSON.parse(msgBuffer.toString());
			this.log.debug(`Received response from ${rinfo.address}:${rinfo.port}: ${JSON.stringify(response)}`);

			if (response.id !== undefined && this._pendingRequests.has(response.id)) {
				const pending = this._pendingRequests.get(response.id);
				this.clearTimeout(pending.timeout);
				this._pendingRequests.delete(response.id);
				if (pending.method) {
					this._pendingRequestsByMethod?.delete(pending.method);
				}

				if (response.error) {
					pending.reject(new Error(`API Error ${response.error.code}: ${response.error.message}`));
					this.log.debug(`Request ${response.id} failed: ${response.error.message}`);
				} else {
					const resultValue = response.result;
					pending.resolve(resultValue);
					this.log.debug(`Request ${response.id} succeeded`);
				}
			} else if (response.result && response.result.device) {
				this.log.info(`Discovered device: ${response.result.device} at ${response.result.ip}`);
				this.log.debug(`Device details: ${JSON.stringify(response.result)}`);

				if (response.result && response.result.ip) {
					if (!this.config.ipAddress) {
						this._discoveredIP = response.result.ip;
						this._discoveredDeviceModel = response.result.device;
						this.log.info(
							`Auto-selecting discovered device: ${this._discoveredIP} (${this._discoveredDeviceModel})`,
						);
						this.startPolling();
						this.setState("info.device", { val: response.result.device, ack: true });
						this.setState("info.firmware", { val: String(response.result.ver), ack: true });
						this.setState("info.mac", {
							val: response.result.ble_mac || response.result.wifi_mac,
							ack: true,
						});
					} else {
						this.log.info(`Device discovered but using configured IP: ${this.config.ipAddress}`);
					}
				} else {
					this.log.warn(`Received discovery response without IP address: ${JSON.stringify(response.result)}`);
				}
			} else if (response.error) {
				const apiCode = response.error.code;
				const apiMessage = response.error.message;
				this.log.debug(`Received API error response (${apiCode}): ${apiMessage}`);
			} else {
				this.log.debug(`Received unsolicited message: ${JSON.stringify(response)}`);
			}
		} catch (e) {
			this.log.debug(`Invalid response received: ${e.message}`);
			this.log.debug(`Raw message: ${msgBuffer.toString()}`);
			this.log.debug(`From: ${rinfo.address}:${rinfo.port}`);
		}
	}

	/**
	 *
	 */
	startFastPolling() {
		if (this.config.enableESStatus === false) {
			this.log.info("Fast-Polling disabled - ES.GetStatus not enabled in config");
			return;
		}
		const fastInterval = this.config.fastPollInterval || DEFAULT_FAST_POLL_INTERVAL;
		this.log.info(`Starting Fast-Polling (every ${fastInterval}ms)`);
		if (this._fastPollTimer) {
			this.clearInterval(this._fastPollTimer);
			this._fastPollTimer = null;
		}
		this._fastPollTimer = this.setInterval(() => this.pollESStatus(), fastInterval);
		this.pollESStatus();
	}

	/**
	 *
	 */
	startPolling() {
		const pollInterval = this.config.pollInterval || DEFAULT_POLL_INTERVAL;
		this.log.info(`Starting Standard-Polling (every ${pollInterval}ms)`);
		if (this._normalPollTimer) {
			this.clearInterval(this._normalPollTimer);
			this._normalPollTimer = null;
		}
		this._normalPollTimer = this.setInterval(() => this.poll(), pollInterval);
		this.startFastPolling();
		this.startSlowPolling();
		this.poll();
	}

	/**
	 *
	 */
	startSlowPolling() {
		if (this.config.enableWifiStatus === false && this.config.enableBLEStatus === false) {
			this.log.info("Long-Polling disabled - no Long-Polling endpoints enabled in config");
			return;
		}
		const slowInterval = this.config.slowPollInterval || DEFAULT_SLOW_POLL_INTERVAL;
		this.log.info(`Starting Long-Polling (every ${slowInterval}ms)`);
		if (this._slowPollTimer) {
			this.clearInterval(this._slowPollTimer);
			this._slowPollTimer = null;
		}
		this._slowPollTimer = this.setInterval(() => this.pollSlow(), slowInterval);
		this.pollSlow();
	}

	/**
	 *
	 */
	stopPolling() {
		if (this._normalPollTimer) {
			this.clearInterval(this._normalPollTimer);
			this._normalPollTimer = null;
		}
		if (this._slowPollTimer) {
			this.clearInterval(this._slowPollTimer);
			this._slowPollTimer = null;
		}
		if (this._fastPollTimer) {
			this.clearInterval(this._fastPollTimer);
			this._fastPollTimer = null;
		}
	}

	/**
	 *
	 * @param obj
	 */
	async onMessage(obj) {
		if (obj.command === "discover") {
			await this.discoverDevices();
			if (obj.callback) {
				this.sendTo(
					obj.from,
					obj.command,
					{
						success: !!this._discoveredIP,
						ipAddress: this._discoveredIP || null,
					},
					obj.callback,
				);
			}
		} else if (obj.command === "setSettings") {
			const settings = obj.values;
			this.config.autoDiscovery = !!settings.autoDiscovery;
			this.config.ipAddress = typeof settings.ipAddress === "string" ? settings.ipAddress.trim() : "";
			this.config.udpPort = Math.max(1, Math.min(65535, parseInt(settings.udpPort, 10) || 30000));
			this.config.pollInterval = Math.max(
				20000,
				Math.min(120000, parseInt(settings.pollInterval, 10) || DEFAULT_POLL_INTERVAL),
			);
			this.config.fastPollInterval = Math.max(
				10000,
				Math.min(120000, parseInt(settings.fastPollInterval, 10) || DEFAULT_FAST_POLL_INTERVAL),
			);
			this.config.slowPollInterval = Math.max(
				60000,
				Math.min(3600000, parseInt(settings.slowPollInterval, 10) || DEFAULT_SLOW_POLL_INTERVAL),
			);
			this.config.maxRetries = Math.max(
				1,
				Math.min(10, parseInt(settings.maxRetries, 10) || DEFAULT_MAX_RETRIES),
			);
			this.config.requestTimeout = Math.max(
				1000,
				Math.min(30000, parseInt(settings.requestTimeout, 10) || DEFAULT_REQUEST_TIMEOUT),
			);
			this.config.deviceModel = settings.deviceModel || "";
			this.config.enableESStatus = settings.enableESStatus !== false;
			this.config.enableBatteryStatus = settings.enableBatteryStatus !== false;
			this.config.enableEMStatus = settings.enableEMStatus !== false;
			this.config.enableModeStatus = settings.enableModeStatus !== false;
			this.config.enablePVStatus = settings.enablePVStatus !== false;
			this.config.enableWifiStatus = settings.enableWifiStatus !== false;
			this.config.enableBLEStatus = settings.enableBLEStatus !== false;

			await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
				native: {
					autoDiscovery: this.config.autoDiscovery,
					ipAddress: this.config.ipAddress,
					udpPort: this.config.udpPort,
					pollInterval: this.config.pollInterval,
					fastPollInterval: this.config.fastPollInterval,
					slowPollInterval: this.config.slowPollInterval,
					maxRetries: this.config.maxRetries,
					requestTimeout: this.config.requestTimeout,
					deviceModel: this.config.deviceModel,
					enableESStatus: this.config.enableESStatus,
					enableBatteryStatus: this.config.enableBatteryStatus,
					enableEMStatus: this.config.enableEMStatus,
					enableModeStatus: this.config.enableModeStatus,
					enablePVStatus: this.config.enablePVStatus,
					enableWifiStatus: this.config.enableWifiStatus,
					enableBLEStatus: this.config.enableBLEStatus,
				},
			});

			this.log.info("Settings saved and persisted");

			this.stopPolling();
			this.startPolling();

			if (obj.callback) {
				this.sendTo(obj.from, obj.command, { success: true }, obj.callback);
			}
		} else if (obj.command === "getSettings") {
			if (obj.callback) {
				this.sendTo(
					obj.from,
					obj.command,
					{
						values: {
							autoDiscovery: this.config.autoDiscovery,
							ipAddress: this.config.ipAddress,
							udpPort: this.config.udpPort,
							pollInterval: this.config.pollInterval,
							fastPollInterval: this.config.fastPollInterval,
							slowPollInterval: this.config.slowPollInterval,
							maxRetries: this.config.maxRetries,
							requestTimeout: this.config.requestTimeout,
							deviceModel: this.config.deviceModel,
							enableESStatus: this.config.enableESStatus,
							enableBatteryStatus: this.config.enableBatteryStatus,
							enableEMStatus: this.config.enableEMStatus,
							enableModeStatus: this.config.enableModeStatus,
							enablePVStatus: this.config.enablePVStatus,
							enableWifiStatus: this.config.enableWifiStatus,
							enableBLEStatus: this.config.enableBLEStatus,
						},
					},
					obj.callback,
				);
			}
		} else {
			this.log.debug(`Unknown message command received: ${obj.command}`);
		}
	}

	/**
	 *
	 * @param callback
	 */
	onUnload(callback) {
		try {
			this.log.info("Shutting down Marstek Venus adapter");

			this.stopPolling();

			if (this._requestQueue) {
				this._requestQueue.clear(this);
			}
			if (this._socket) {
				this._socket.close();
			}

			for (const [id, pending] of [...this._pendingRequests.entries()]) {
				this.clearTimeout(pending.timeout);
				pending.reject(new Error("Adapter shutting down"));
				this._pendingRequests.delete(id);
			}

			callback();
		} catch (err) {
			this.log.error(`Error during shutdown: ${err.message}`);
			callback();
		}
	}

	/**
	 *
	 */
	async initStates() {
		if (AdapterMixin && AdapterMixin.prototype && AdapterMixin.prototype.initStates) {
			await AdapterMixin.prototype.initStates.call(this);
		} else {
			this.log.warn("initStates: AdapterMixin not available");
		}
	}

	/**
	 *
	 */
	async discoverDevices() {
		if (Discovery && Discovery.discoverDevices) {
			await Discovery.discoverDevices.call(this);
		}
	}

	/**
	 *
	 * @param fn
	 * @param maxRetries
	 */
	async pollWithRetry(fn, maxRetries) {
		if (Polling && Polling.pollWithRetry) {
			return Polling.pollWithRetry.call(this, fn, maxRetries);
		}
		return fn();
	}

	/**
	 *
	 */
	async poll() {
		if (Polling && Polling.poll) {
			await Polling.poll.call(this);
		}
	}

	/**
	 *
	 */
	async pollSlow() {
		if (Polling && Polling.pollSlow) {
			await Polling.pollSlow.call(this);
		}
	}

	/**
	 *
	 */
	async pollESStatus() {
		if (Polling && Polling.pollESStatus) {
			await Polling.pollESStatus.call(this);
		}
	}

	/**
	 *
	 */
	async pollBatteryStatus() {
		if (Polling && Polling.pollBatteryStatus) {
			await Polling.pollBatteryStatus.call(this);
		}
	}

	/**
	 *
	 */
	async pollPVStatus() {
		if (Polling && Polling.pollPVStatus) {
			await Polling.pollPVStatus.call(this);
		}
	}

	/**
	 *
	 */
	async pollWifiStatus() {
		if (Polling && Polling.pollWifiStatus) {
			await Polling.pollWifiStatus.call(this);
		}
	}

	/**
	 *
	 */
	async pollBLEStatus() {
		if (Polling && Polling.pollBLEStatus) {
			await Polling.pollBLEStatus.call(this);
		}
	}

	/**
	 *
	 */
	async pollEMStatus() {
		if (Polling && Polling.pollEMStatus) {
			await Polling.pollEMStatus.call(this);
		}
	}

	/**
	 *
	 */
	async pollModeStatus() {
		if (Polling && Polling.pollModeStatus) {
			await Polling.pollModeStatus.call(this);
		}
	}

	/**
	 *
	 */
	hasPVSupport() {
		if (Polling && Polling.hasPVSupport) {
			return Polling.hasPVSupport.call(this);
		}
		return true;
	}

	/**
	 *
	 * @param id
	 * @param state
	 */
	async onStateChange(id, state) {
		if (Control && Control.onStateChange) {
			await Control.onStateChange.call(this, id, state);
		}
	}

	/**
	 *
	 * @param value
	 */
	async setControlTarget(value) {
		if (Control && Control.setControlTarget) {
			await Control.setControlTarget.call(this, value);
		}
	}
}

module.exports = MarstekVenusAdapter;
module.exports.createAdapter = options => new MarstekVenusAdapter(options);

if (!module.parent) {
	new MarstekVenusAdapter();
}
