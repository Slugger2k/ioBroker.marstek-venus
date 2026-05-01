"use strict";

const chai = require("chai");
const sinon = require("sinon");
const dgram = require("node:dgram");
const expect = chai.expect;

// Mock external dependencies FIRST
const mockSocket = {
	on: sinon.stub(),
	bind: sinon.stub().callsFake((port, cb) => typeof cb === "function" && cb(null)),
	setBroadcast: sinon.stub(),
	address: sinon.stub().returns({ address: "0.0.0.0", port: 12345 }),
	send: sinon.stub().callsFake((buf, offset, len, port, addr, cb) => {
		if (typeof cb === "function") {
			cb(null);
		}
		return null;
	}),
	close: sinon.stub(),
};
sinon.stub(dgram, "createSocket").returns(mockSocket);

// Mock the adapter core base class
class MockAdapterBase {
	constructor(options) {
		this.name = options.name;
		this.namespace = `${options.name}.0`;
		this.config = options.config;
		this.log = {
			info: sinon.stub(),
			debug: sinon.stub(),
			warn: sinon.stub(),
			error: sinon.stub(),
			silly: sinon.stub(),
		};
		this.setState = sinon.stub().resolves();
		this.setStateChangedAsync = sinon.stub().resolves();
		this.setObject = sinon.stub().resolves();
		this.extendForeignObjectAsync = sinon.stub().resolves();
		this.setObjectNotExistsAsync = sinon.stub().resolves();
		this.getStateAsync = sinon.stub().resolves();
		this.subscribeStatesAsync = sinon.stub().resolves();
		this.sendTo = sinon.stub();
		this._eventHandlers = {};
		this._timers = new Set();
		this._intervals = new Set();
	}

	on(event, handler) {
		this._eventHandlers[event] = handler;
	}

	emit(event, ...args) {
		if (this._eventHandlers[event]) {
			this._eventHandlers[event](...args);
		}
	}

	setTimeout(callback, ms) {
		const timer = setTimeout(callback, ms);
		this._timers.add(timer);
		return timer;
	}

	clearTimeout(timer) {
		if (timer) {
			clearTimeout(timer);
			this._timers.delete(timer);
		}
	}

	setInterval(callback, ms) {
		const timer = setInterval(callback, ms);
		this._intervals.add(timer);
		return timer;
	}

	clearInterval(timer) {
		if (timer) {
			clearInterval(timer);
			this._intervals.delete(timer);
		}
	}
}

// Mock @iobroker/adapter-core
const mockAdapterCore = {
	Adapter: MockAdapterBase,
};
require.cache[require.resolve("@iobroker/adapter-core")] = { exports: mockAdapterCore };

// Now load the actual adapter - clear ALL caches including adapter-core
const adapterCorePath = require.resolve("@iobroker/adapter-core");
Object.keys(require.cache).forEach(key => {
	if (key === adapterCorePath || key.includes("/lib/") || key.endsWith("main.js")) {
		delete require.cache[key];
	}
});
// Re-mock adapter-core
require.cache[adapterCorePath] = { exports: mockAdapterCore };
const MarstekVenusAdapter = require("../main.js");
const Adapter = options => new MarstekVenusAdapter(options);

describe("MarstekVenusAdapter", function () {
	let adapter;
	let sandbox;
	let clock;

	this.timeout(20000);

	beforeEach(() => {
		sandbox = sinon.createSandbox();
		clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true });

		// Reset socket mock completely
		mockSocket.on.resetHistory();
		mockSocket.bind.reset();
		mockSocket.bind.callsFake((port, cb) => {
			if (typeof cb === "function") {
				cb(null);
			}
		});
		mockSocket.setBroadcast.resetHistory();
		mockSocket.address.resetHistory();
		mockSocket.send.reset();
		mockSocket.send.callsFake((buf, offset, len, port, addr, cb) => {
			if (typeof cb === "function") {
				cb(null);
			}
			return null;
		});
		mockSocket.close.resetHistory();

		// Create fresh adapter instance
		adapter = Adapter({
			config: {
				autoDiscovery: false,
				ipAddress: "192.168.1.100",
				udpPort: 30000,
				pollInterval: 10000,
			},
		});

		// Clear pending requests and intervals from any accidental polls triggered during setup
		adapter._pendingRequests.clear();
		adapter._pendingRequestsByMethod = new Map();
		if (adapter._normalPollTimer) {
			adapter.clearInterval(adapter._normalPollTimer);
			adapter._normalPollTimer = null;
		}
		if (adapter._slowPollTimer) {
			adapter.clearInterval(adapter._slowPollTimer);
			adapter._slowPollTimer = null;
		}
		if (adapter._fastPollTimer) {
			adapter.clearInterval(adapter._fastPollTimer);
			adapter._fastPollTimer = null;
		}
		if (adapter._requestQueue && adapter._requestQueue.clear) {
			try {
				adapter._requestQueue.clear();
			} catch {
				// Ignore clear errors during cleanup
			}
		}
		adapter._pollingInProgress = false;
		adapter._pollFailureCount = 0;
	});

	afterEach(() => {
		sandbox.restore();
		clock.restore();
		adapter = null;
	});

	describe("Constructor", () => {
		it("initializes all properties correctly", () => {
			expect(adapter._requestId).to.equal(1);
			expect(adapter._pendingRequests).to.be.instanceOf(Map);
			expect(adapter._normalPollTimer).to.be.null;
			expect(adapter._slowPollTimer).to.be.null;
			expect(adapter._fastPollTimer).to.be.null;
			expect(adapter._discoveredIP).to.be.null;
			expect(adapter._pollingInProgress).to.be.false;
			expect(adapter._pollFailureCount).to.equal(0);
		});

		it("binds all lifecycle event handlers", () => {
			expect(adapter._eventHandlers.ready).to.exist;
			expect(adapter._eventHandlers.stateChange).to.exist;
			expect(adapter._eventHandlers.unload).to.exist;
			expect(adapter._eventHandlers.message).to.exist;
		});
	});

	describe("Lifecycle methods", () => {
		describe("onReady()", () => {
			it("initializes states and creates socket", async () => {
				await adapter.onReady();

				expect(adapter.setObjectNotExistsAsync.callCount).to.equal(55);
				expect(adapter.subscribeStatesAsync.calledWith("control.*")).to.be.true;
				expect(dgram.createSocket.calledWith("udp4")).to.be.true;
				expect(mockSocket.bind.called).to.be.true;
				expect(mockSocket.setBroadcast.calledWith(true)).to.be.true;
			});

			it("starts polling when IP is configured", async () => {
				await adapter.onReady();
				expect(adapter._normalPollTimer).to.not.be.null;
				expect(adapter._slowPollTimer).to.not.be.null;
			});

			it("logs socket error when error event occurs", async () => {
				await adapter.onReady();
				const errorHandler = mockSocket.on.getCall(0).args[1];
				const error = new Error("Test socket error");
				errorHandler(error);
				expect(adapter.log.error.calledWith(`UDP socket error: ${error.message}`)).to.be.true;
			});
		});

		describe("onUnload()", () => {
			it("cleans up all resources", done => {
				adapter._socket = mockSocket;
				adapter._normalPollTimer = setInterval(() => {}, 1000);
				adapter._slowPollTimer = setInterval(() => {}, 1000);

				const timeout = setTimeout(() => {}, 1000);
				const rejectSpy = sandbox.stub();
				adapter._pendingRequests.set(1, { timeout, reject: rejectSpy });

				adapter.onUnload(() => {
					expect(mockSocket.close.calledOnce).to.be.true;
					expect(rejectSpy.calledOnce).to.be.true;
					done();
				});
			});
		});

		describe("onMessage()", () => {
			it("handles discover command", async () => {
				adapter.discoverDevices = sandbox.stub().resolves();
				adapter._discoveredIP = "192.168.1.100";

				await adapter.onMessage({
					command: "discover",
					from: "admin.0",
					callback: 123,
				});

				expect(adapter.discoverDevices.called).to.be.true;
				expect(adapter.sendTo.called).to.be.true;
			});

			it("handles setSettings command", async () => {
				adapter.config.autoDiscovery = false;
				adapter.config.ipAddress = "192.168.1.50";
				adapter.config.udpPort = 30000;
				adapter.config.pollInterval = 10000;

				await adapter.onMessage({
					command: "setSettings",
					values: {
						autoDiscovery: true,
						ipAddress: "192.168.1.100",
						udpPort: 30001,
						pollInterval: 70000,
					},
				});

				expect(adapter.config.autoDiscovery).to.be.true;
				expect(adapter.config.ipAddress).to.equal("192.168.1.100");
				expect(adapter.config.udpPort).to.equal(30001);
				expect(adapter.config.pollInterval).to.equal(70000);
				expect(adapter.log.info.calledWith("Settings saved and persisted")).to.be.true;
			});
		});
	});

	describe("sendRequest()", () => {
		beforeEach(async () => {
			await adapter.onReady();
			if (adapter._normalPollTimer) {
				clearInterval(adapter._normalPollTimer);
			}
			if (adapter._slowPollTimer) {
				clearInterval(adapter._slowPollTimer);
			}
			if (adapter.fastPollInterval) {
				clearInterval(adapter.fastPollInterval);
			}
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter.fastPollInterval = null;
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("rejects when no target IP", async () => {
			adapter.config.ipAddress = "";
			adapter._discoveredIP = null;

			try {
				await adapter.sendRequest("ES.GetStatus");
				expect.fail("Should reject");
			} catch (e) {
				expect(e.message).to.equal("No target IP configured");
			}
		});

		it("adds request to pending queue", async () => {
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
			const promise = adapter.sendRequest("ES.GetStatus");
			clock.tick(1);
			expect(adapter._pendingRequests.size).to.equal(1);

			const req = adapter._pendingRequests.values().next().value;
			clearTimeout(req.timeout);
			req.resolve({ ok: true });

			expect(await promise).to.deep.equal({ ok: true });
		});

		it("handles timeout correctly", async () => {
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
			const promise = adapter.sendRequest("ES.GetStatus");
			clock.tick(1);
			clock.tick(10000);

			try {
				await promise;
				expect.fail("Should timeout");
			} catch (e) {
				expect(e.message).to.include("timed out");
			}
		});

		it("does not retry internally on timeout", async () => {
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
			adapter.config.requestTimeout = 5000;
			mockSocket.send.resetHistory();
			const promise = adapter.sendRequest("ES.GetStatus");
			clock.tick(1);
			clock.tick(5001);
			// Single attempt only — no internal retries
			expect(mockSocket.send.callCount).to.equal(1);
			try {
				await promise;
			} catch {
				// Expected to timeout
			}
		});

		it("handles socket send errors", async () => {
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
			mockSocket.send.callsArgWith(5, new Error("Send failed"));
			clock.tick(1);

			try {
				await adapter.sendRequest("ES.GetStatus");
				expect.fail("Should reject");
			} catch (e) {
				expect(e.message).to.equal("Send failed");
			}
		});
	});

	describe("handleResponse()", () => {
		beforeEach(async () => {
			await adapter.onReady();
			if (adapter._normalPollTimer) {
				clearInterval(adapter._normalPollTimer);
			}
			if (adapter._slowPollTimer) {
				clearInterval(adapter._slowPollTimer);
			}
			if (adapter.fastPollInterval) {
				clearInterval(adapter.fastPollInterval);
			}
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter.fastPollInterval = null;
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("resolves pending request on success", async () => {
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
			const promise = adapter.sendRequest("ES.GetStatus");
			clock.tick(1);
			const reqId = adapter._requestId - 1;

			adapter.handleResponse(Buffer.from(JSON.stringify({ id: reqId, result: { soc: 98 } })), {
				address: "192.168.1.100",
			});

			expect(await promise).to.deep.equal({ soc: 98 });
		});

		it("rejects on error response", async () => {
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
			const promise = adapter.sendRequest("ES.GetStatus");
			clock.tick(1);
			const reqId = adapter._requestId - 1;

			adapter.handleResponse(Buffer.from(JSON.stringify({ id: reqId, error: { code: -1, message: "Error" } })), {
				address: "192.168.1.100",
			});

			try {
				await promise;
				expect.fail("Should reject");
			} catch (e) {
				expect(e.message).to.include("Error");
			}
		});

		it("handles discovery responses", () => {
			adapter.config.ipAddress = "";

			adapter.handleResponse(
				Buffer.from(JSON.stringify({ result: { device: "Venus C", ip: "192.168.1.100" } })),
				{ address: "192.168.1.100" },
			);

			// Wait for discovery handler to complete
			clock.tick(100);
			expect(adapter._discoveredIP).to.equal("192.168.1.100");
		});

		it("ignores discovery when IP already configured", () => {
			adapter.config.ipAddress = "192.168.1.50";
			adapter.startPolling = sandbox.stub();

			adapter.handleResponse(
				Buffer.from(JSON.stringify({ result: { device: "Venus C", ip: "192.168.1.100" } })),
				{ address: "192.168.1.100" },
			);

			expect(adapter._discoveredIP).to.be.null;
			expect(adapter.log.info.calledWithMatch(/using configured IP/)).to.be.true;
		});

		it("warns on discovery response without IP", () => {
			adapter.config.ipAddress = "";

			adapter.handleResponse(Buffer.from(JSON.stringify({ result: { device: "Venus C" } })), {
				address: "192.168.1.100",
			});

			expect(adapter.log.warn.calledWithMatch(/without IP address/)).to.be.true;
		});

		it("ignores unsolicited messages", () => {
			adapter.handleResponse(Buffer.from(JSON.stringify({ method: "SomeEvent", data: 123 })), {
				address: "192.168.1.100",
			});

			expect(adapter.log.debug.calledWithMatch(/unsolicited message/)).to.be.true;
		});

		it("logs unmatched API error responses without treating them as unsolicited method", () => {
			adapter.handleResponse(
				Buffer.from(
					JSON.stringify({ id: 0, src: "VenusA-abc", error: { code: -32602, message: "Invalid params" } }),
				),
				{ address: "192.168.1.100", port: 30000 },
			);

			expect(adapter.log.debug.calledWithMatch(/Received API error response \(-32602\): Invalid params/)).to.be
				.true;
		});

		it("ignores invalid JSON", () => {
			adapter.handleResponse(Buffer.from("invalid json"), { address: "192.168.1.100" });
			expect(adapter.log.debug.calledWithMatch(/Invalid response/)).to.be.true;
		});
	});

	describe("Operating modes", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter.sendRequest = sandbox.stub().resolves();
		});

		it("handles Auto mode", async () => {
			await adapter.onStateChange("control.mode", { val: "Auto", ack: false });
			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: { mode: "Auto", auto_cfg: { enable: 1 } },
					}),
				),
			).to.be.true;
		});

		it("handles AI mode", async () => {
			await adapter.onStateChange("control.mode", { val: "AI", ack: false });
			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: { mode: "AI", ai_cfg: { enable: 1 } },
					}),
				),
			).to.be.true;
		});

		it("handles Passive mode", async () => {
			adapter.getStateAsync.withArgs("control.passivePower").resolves({ val: 500 });
			adapter.getStateAsync.withArgs("control.passiveDuration").resolves({ val: 600 });

			await adapter.onStateChange("control.mode", { val: "Passive", ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: { mode: "Passive", passive_cfg: { power: 500, cd_time: 600 } },
					}),
				),
			).to.be.true;
		});

		it("handles Passive mode with null power/duration", async () => {
			adapter.getStateAsync.withArgs("control.passivePower").resolves(null);
			adapter.getStateAsync.withArgs("control.passiveDuration").resolves(null);

			await adapter.onStateChange("control.mode", { val: "Passive", ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: { mode: "Passive", passive_cfg: { power: 0, cd_time: 300 } },
					}),
				),
			).to.be.true;
		});

		it("handles Manual mode", async () => {
			adapter.getStateAsync.withArgs("control.manualTimeNum").resolves({ val: 1 });
			adapter.getStateAsync.withArgs("control.manualStartTime").resolves({ val: "08:00" });
			adapter.getStateAsync.withArgs("control.manualEndTime").resolves({ val: "20:00" });
			adapter.getStateAsync.withArgs("control.manualWeekdays").resolves({ val: 127 });
			adapter.getStateAsync.withArgs("control.manualPower").resolves({ val: 1000 });
			adapter.getStateAsync.withArgs("control.manualEnable").resolves({ val: true });

			await adapter.onStateChange("control.mode", { val: "Manual", ack: false });

			expect(adapter.sendRequest.calledWith("ES.SetMode", sinon.match.has("config"))).to.be.true;
		});

		it("handles Manual mode with null values", async () => {
			adapter.getStateAsync.withArgs("control.manualTimeNum").resolves(null);
			adapter.getStateAsync.withArgs("control.manualStartTime").resolves(null);
			adapter.getStateAsync.withArgs("control.manualEndTime").resolves(null);
			adapter.getStateAsync.withArgs("control.manualWeekdays").resolves(null);
			adapter.getStateAsync.withArgs("control.manualPower").resolves(null);
			adapter.getStateAsync.withArgs("control.manualEnable").resolves(null);

			await adapter.onStateChange("control.mode", { val: "Manual", ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: sinon.match({
							mode: "Manual",
							manual_cfg: sinon.match({
								time_num: 0,
								start_time: "00:00",
								end_time: "23:59",
								week_set: 127,
								power: 100,
								enable: 0,
							}),
						}),
					}),
				),
			).to.be.true;
		});

		it("handles Ups mode using ups_cfg", async () => {
			await adapter.onStateChange("control.mode", { val: "Ups", ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: { mode: "Ups", ups_cfg: { enable: 1 } },
					}),
				),
			).to.be.true;
		});

		it("normalizes UPS mode to Ups", async () => {
			await adapter.onStateChange("control.mode", { val: "UPS", ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: { mode: "Ups", ups_cfg: { enable: 1 } },
					}),
				),
			).to.be.true;
		});

		it("handles DOD control state", async () => {
			await adapter.onStateChange("control.dodValue", { val: 40, ack: false });

			expect(adapter.sendRequest.calledWith("DOD.SET", { id: 0, value: 40 })).to.be.true;
		});

		it("clamps DOD control value to API range", async () => {
			await adapter.onStateChange("control.dodValue", { val: 10, ack: false });

			expect(adapter.sendRequest.calledWith("DOD.SET", { id: 0, value: 30 })).to.be.true;
		});

		it("handles BLE broadcast control state", async () => {
			await adapter.onStateChange("control.bleBroadcastEnabled", { val: false, ack: false });

			expect(adapter.sendRequest.calledWith("Ble.Adv", { id: 0, enable: 1 })).to.be.true;
		});

		it("handles LED control state", async () => {
			await adapter.onStateChange("control.ledState", { val: true, ack: false });

			expect(adapter.sendRequest.calledWith("Led.Ctrl", { id: 0, state: 1 })).to.be.true;
		});
	});

	describe("Poll functions", () => {
		beforeEach(async () => {
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter._pollingInProgress = false;
		});

		it("updates connection state on successful poll", async () => {
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter.setState.calledWith("info.connection", { val: true, ack: true })).to.be.true;
			expect(adapter._pollFailureCount).to.equal(0);
		});

		it("handles poll cycle throw", async () => {
			sandbox.stub(adapter, "pollWithRetry").callsFake(async () => {
				throw new Error("Poll error");
			});

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(1);
		});

		it("handles poll cycle throw with 3 failures", async () => {
			sandbox.stub(adapter, "pollWithRetry").callsFake(async () => {
				throw new Error("Poll error");
			});

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(1);
			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(2);
			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(3);
			expect(adapter.setState.calledWith("info.connection", { val: false, ack: true })).to.be.true;
		});

		it("handles pollWithRetry returning false", async () => {
			sandbox.stub(adapter, "pollWithRetry").resolves(false);

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(1);
		});

		it("does not mark connection false on single poll failure", async () => {
			sandbox.stub(adapter, "pollWithRetry").callsFake(async fn => {
				try {
					await fn();
					return true;
				} catch {
					return false;
				}
			});

			await adapter.poll();
			expect(adapter.setState.calledWith("info.connection", { val: false, ack: true })).to.be.false;
			expect(adapter._pollFailureCount).to.equal(1);
		});

		it("marks connection false after 3 consecutive poll failures", async () => {
			sandbox.stub(adapter, "pollWithRetry").callsFake(async fn => {
				try {
					await fn();
					return true;
				} catch {
					return false;
				}
			});

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(1);
			expect(adapter.setState.calledWith("info.connection", { val: false, ack: true })).to.be.false;

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(2);
			expect(adapter.setState.calledWith("info.connection", { val: false, ack: true })).to.be.false;

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(3);
			expect(adapter.setState.calledWith("info.connection", { val: false, ack: true })).to.be.true;
		});

		it("resets failure count on successful poll after failures", async () => {
			sandbox.stub(adapter, "pollWithRetry").callsFake(async fn => {
				try {
					await fn();
					return true;
				} catch {
					return false;
				}
			});

			// First two polls fail (all poll functions fail)
			adapter.pollBatteryStatus = sandbox.stub().rejects(new Error("Failed"));
			adapter.pollPVStatus = sandbox.stub().rejects(new Error("Failed"));
			adapter.pollEMStatus = sandbox.stub().rejects(new Error("Failed"));
			adapter.pollModeStatus = sandbox.stub().rejects(new Error("Failed"));

			await adapter.poll();
			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(2);

			// Third poll succeeds
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter._pollFailureCount).to.equal(0);
			expect(adapter.setState.calledWith("info.connection", { val: true, ack: true })).to.be.true;
		});

		it("skips overlapping polls", async () => {
			adapter._pollingInProgress = true;

			await adapter.poll();
			expect(adapter._pollingInProgress).to.be.true;
		});

		it("retries failed poll before marking failure", async () => {
			sandbox.stub(global, "setTimeout").callsFake(fn => {
				fn();
				return 1;
			});

			let attempts = 0;
			adapter.pollBatteryStatus = sandbox.stub().callsFake(() => {
				attempts++;
				if (attempts < 2) {
					return Promise.reject(new Error("Transient failure"));
				}
				return Promise.resolve();
			});
			adapter.pollPVStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(attempts).to.equal(2);
			expect(adapter._pollFailureCount).to.equal(0);
		});

		it("returns false when all retry attempts fail", async () => {
			sandbox.stub(global, "setTimeout").callsFake(fn => {
				fn();
				return 1;
			});
			adapter.pollESStatus = sandbox.stub().rejects(new Error("Permanent failure"));

			const result = await adapter.pollWithRetry(() => adapter.pollESStatus());
			expect(result).to.be.false;
		});

		it("returns true on successful attempt", async () => {
			sandbox.stub(global, "setTimeout").callsFake(fn => {
				fn();
				return 1;
			});
			adapter.pollESStatus = sandbox.stub().resolves();

			const result = await adapter.pollWithRetry(() => adapter.pollESStatus());
			expect(result).to.be.true;
		});
	});

	describe("Endpoint config filtering", () => {
		beforeEach(async () => {
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter._pollingInProgress = false;
			adapter._slowPollingInProgress = false;
			adapter._pollFailureCount = 0;
		});

		it("skips battery polling when enableBatteryStatus is false", async () => {
			adapter.config.enableBatteryStatus = false;
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter.pollBatteryStatus.called).to.be.false;
			expect(adapter.pollEMStatus.called).to.be.true;
		});

		it("skips EM polling when enableEMStatus is false", async () => {
			adapter.config.enableEMStatus = false;
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter.pollEMStatus.called).to.be.false;
			expect(adapter.pollBatteryStatus.called).to.be.true;
		});

		it("skips mode polling when enableModeStatus is false", async () => {
			adapter.config.enableModeStatus = false;
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter.pollModeStatus.called).to.be.false;
		});

		it("skips PV polling when enablePVStatus is false", async () => {
			adapter.config.enablePVStatus = false;
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter.pollPVStatus.called).to.be.false;
		});

		it("skips PV polling when enabled but device has no PV support", async () => {
			adapter.config.enablePVStatus = true;
			adapter._discoveredDeviceModel = "VenusC";
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();
			expect(adapter.pollPVStatus.called).to.be.false;
		});

		it("returns early when all normal endpoints disabled", async () => {
			adapter.config.enableBatteryStatus = false;
			adapter.config.enableEMStatus = false;
			adapter.config.enableModeStatus = false;
			adapter.config.enablePVStatus = false;

			await adapter.poll();
			expect(adapter.setState.calledWith("info.connection")).to.be.false;
			expect(adapter._pollFailureCount).to.equal(0);
		});

		it("skips wifi polling when enableWifiStatus is false", async () => {
			adapter.config.enableWifiStatus = false;
			adapter.pollWifiStatus = sandbox.stub().resolves();
			adapter.pollBLEStatus = sandbox.stub().resolves();

			await adapter.pollSlow();
			expect(adapter.pollWifiStatus.called).to.be.false;
			expect(adapter.pollBLEStatus.called).to.be.true;
		});

		it("skips BLE polling when enableBLEStatus is false", async () => {
			adapter.config.enableBLEStatus = false;
			adapter.pollWifiStatus = sandbox.stub().resolves();
			adapter.pollBLEStatus = sandbox.stub().resolves();

			await adapter.pollSlow();
			expect(adapter.pollBLEStatus.called).to.be.false;
			expect(adapter.pollWifiStatus.called).to.be.true;
		});

		it("does not start fast poll timer when enableESStatus is false", () => {
			adapter.config.enableESStatus = false;
			adapter.startFastPolling();
			expect(adapter._fastPollTimer).to.be.null;
		});

		it("does not start slow poll timer when both wifi and BLE disabled", () => {
			adapter.config.enableWifiStatus = false;
			adapter.config.enableBLEStatus = false;
			adapter.startSlowPolling();
			expect(adapter._slowPollTimer).to.be.null;
		});

		it("starts slow poll timer when only wifi is enabled", () => {
			adapter.config.enableWifiStatus = true;
			adapter.config.enableBLEStatus = false;
			adapter.pollWifiStatus = sandbox.stub().resolves();
			adapter.pollBLEStatus = sandbox.stub().resolves();
			adapter.startSlowPolling();
			expect(adapter._slowPollTimer).to.not.be.null;
		});
	});

	describe("Device model filtering", () => {
		beforeEach(async () => {
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter._pollingInProgress = false;
			adapter._discoveredDeviceModel = null;
		});

		it("hasPVSupport returns true for VenusD", () => {
			adapter._discoveredDeviceModel = "VenusD";
			expect(adapter.hasPVSupport()).to.be.true;
		});

		it("hasPVSupport returns true for VenusA", () => {
			adapter._discoveredDeviceModel = "VenusA";
			expect(adapter.hasPVSupport()).to.be.true;
		});

		it("hasPVSupport returns false for VenusE", () => {
			adapter._discoveredDeviceModel = "VenusE";
			expect(adapter.hasPVSupport()).to.be.false;
		});

		it("hasPVSupport returns false for VenusC", () => {
			adapter._discoveredDeviceModel = "VenusC";
			expect(adapter.hasPVSupport()).to.be.false;
		});

		it("hasPVSupport returns true for VenusD 3.0", () => {
			adapter._discoveredDeviceModel = "VenusD 3.0";
			expect(adapter.hasPVSupport()).to.be.true;
		});

		it("hasPVSupport returns true for VenusA 3.0", () => {
			adapter._discoveredDeviceModel = "VenusA 3.0";
			expect(adapter.hasPVSupport()).to.be.true;
		});

		it("hasPVSupport returns false for VenusE 3.0", () => {
			adapter._discoveredDeviceModel = "VenusE 3.0";
			expect(adapter.hasPVSupport()).to.be.false;
		});

		it("hasPVSupport returns false for VenusC 3.0", () => {
			adapter._discoveredDeviceModel = "VenusC 3.0";
			expect(adapter.hasPVSupport()).to.be.false;
		});

		it("hasPVSupport returns true when no device model known", () => {
			adapter._discoveredDeviceModel = null;
			expect(adapter.hasPVSupport()).to.be.true;
		});

		it("skips PV polling for VenusE device", async () => {
			adapter._discoveredDeviceModel = "VenusE";
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();

			expect(adapter.pollPVStatus.called).to.be.false;
			expect(adapter.pollBatteryStatus.called).to.be.true;
			expect(adapter.pollEMStatus.called).to.be.true;
			expect(adapter.pollModeStatus.called).to.be.true;
		});

		it("calls PV polling for VenusD device", async () => {
			adapter._discoveredDeviceModel = "VenusD";
			adapter.pollBatteryStatus = sandbox.stub().resolves();
			adapter.pollEMStatus = sandbox.stub().resolves();
			adapter.pollModeStatus = sandbox.stub().resolves();
			adapter.pollPVStatus = sandbox.stub().resolves();

			await adapter.poll();

			expect(adapter.pollPVStatus.called).to.be.true;
		});

		it("updates device model from discovery response", () => {
			adapter._discoveredIP = null;
			adapter._discoveredDeviceModel = null;
			adapter.config = { autoDiscovery: true, ipAddress: "" };

			const discoveryResponse = {
				id: 0,
				src: "VenusE-24215ee580e7",
				result: {
					device: "VenusE",
					ver: 111,
					ble_mac: "24215ee580e7",
					wifi_mac: "24215ee580e7",
					ip: "192.168.177.55",
				},
			};

			adapter.handleResponse(JSON.stringify(discoveryResponse), { address: "192.168.177.55", port: 30000 });

			expect(adapter._discoveredDeviceModel).to.equal("VenusE");
		});
	});

	describe("All helper methods", () => {
		beforeEach(async () => {
			await adapter.onReady();
		});

		it("pollESStatus updates all power states", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				pv_power: 500,
				ongrid_power: 200,
				bat_power: -100,
				offgrid_power: 150,
				bat_soc: 85,
				total_pv_energy: 1000,
				total_grid_output_energy: 200,
				total_grid_input_energy: 150,
				total_load_energy: 300,
			});

			await adapter.pollESStatus();
			expect(adapter.setStateChangedAsync.callCount).to.equal(9);
		});

		it("pollESStatus handles partial response", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				pv_power: 500,
			});

			await adapter.pollESStatus();
			expect(adapter.setStateChangedAsync.calledWith("power.pv", { val: 500, ack: true })).to.be.true;
		});

		it("pollBatteryStatus updates states", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				soc: 82,
				bat_temp: 25,
				bat_capacity: 5000,
				rated_capacity: 10000,
				charg_flag: true,
				dischrg_flag: false,
			});

			await adapter.pollBatteryStatus();
			expect(adapter.setStateChangedAsync.calledWith("battery.temperature", { val: 25, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("battery.capacity", { val: 5000, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("battery.ratedCapacity", { val: 10000, ack: true })).to.be
				.true;
			expect(adapter.setStateChangedAsync.calledWith("battery.chargingAllowed", { val: true, ack: true })).to.be
				.true;
			expect(adapter.setStateChangedAsync.calledWith("battery.dischargingAllowed", { val: false, ack: true })).to
				.be.true;
		});

		it("pollWifiStatus updates states", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				sta_ip: "192.168.1.100",
				ssid: "HomeWiFi",
				rssi: -65,
			});

			await adapter.pollWifiStatus();
			expect(adapter.setStateChangedAsync.calledWith("network.ip", { val: "192.168.1.100", ack: true })).to.be
				.true;
		});

		it("re-throws poll errors for retry handling", async () => {
			adapter.sendRequest = sandbox.stub().rejects(new Error("Test error"));

			await adapter.pollESStatus().catch(e => {
				expect(e.message).to.equal("Test error");
			});
			await adapter.pollBatteryStatus().catch(e => {
				expect(e.message).to.equal("Test error");
			});
			await adapter.pollPVStatus().catch(e => {
				expect(e.message).to.equal("Test error");
			});
		});

		it("pollEMStatus updates states", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				ct_state: 1,
				a_power: 100,
				b_power: 200,
				c_power: 300,
				total_power: 600,
			});

			await adapter.pollEMStatus();
			expect(adapter.setStateChangedAsync.calledWith("energymeter.ctState", { val: 1, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerA", { val: 100, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerB", { val: 200, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerC", { val: 300, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerTotal", { val: 600, ack: true })).to.be
				.true;
		});

		it("pollModeStatus updates control mode state", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				mode: "AI",
			});

			await adapter.pollModeStatus();
			expect(adapter.setStateChangedAsync.calledWith("control.mode", { val: "AI", ack: true })).to.be.true;
		});

		it("pollModeStatus updates power states", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				ongrid_power: 123,
				offgrid_power: 456,
				bat_soc: 42,
			});

			await adapter.pollModeStatus();

			expect(adapter.setStateChangedAsync.calledWith("power.grid", { val: 123, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.load", { val: 456, ack: true })).to.be.true;

			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerA", sinon.match.any)).to.be.false;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerB", sinon.match.any)).to.be.false;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerC", sinon.match.any)).to.be.false;

			expect(adapter.setStateChangedAsync.calledWith("battery.soc", { val: 42, ack: true })).to.be.true;
		});

		it("pollModeStatus does not update phase states if no CT is connected", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				ct_state: 0,
			});

			await adapter.pollModeStatus();

			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerA", sinon.match.any)).to.be.false;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerB", sinon.match.any)).to.be.false;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerC", sinon.match.any)).to.be.false;
		});

		it("pollModeStatus updates phase states if CT is connected", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				ct_state: 1,
				a_power: 1,
				b_power: 2,
				c_power: 3,
			});

			await adapter.pollModeStatus();

			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerA", { val: 1, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerB", { val: 2, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("energymeter.powerC", { val: 3, ack: true })).to.be.true;
		});

		it("pollModeStatus handles null mode", async () => {
			adapter.sendRequest = sandbox.stub().resolves({});

			await adapter.pollModeStatus();
			expect(adapter.setStateChangedAsync.called).to.be.false;
		});

		it("pollPVStatus handles null values", async () => {
			adapter.sendRequest = sandbox.stub().resolves({});

			await adapter.pollPVStatus();
			expect(adapter.setStateChangedAsync.called).to.be.false;
		});

		it("pollWifiStatus handles errors gracefully", async () => {
			adapter.sendRequest = sandbox.stub().rejects(new Error("Network error"));

			await adapter.pollWifiStatus();
			expect(adapter.log.warn.calledWithMatch(/Wifi.GetStatus failed/)).to.be.true;
		});

		it("pollBLEStatus updates BLE state", async () => {
			adapter.sendRequest = sandbox.stub().resolves({ state: "connected" });

			await adapter.pollBLEStatus();
			expect(adapter.setStateChangedAsync.calledWith("network.bleState", { val: "connected", ack: true })).to.be
				.true;
		});

		it("pollBLEStatus handles errors gracefully", async () => {
			adapter.sendRequest = sandbox.stub().rejects(new Error("BLE error"));

			await adapter.pollBLEStatus();
			expect(adapter.log.warn.calledWithMatch(/BLE.GetStatus failed/)).to.be.true;
		});

		it("pollESStatus handles errors gracefully and tracks connection", async () => {
			adapter.sendRequest = sandbox.stub().rejects(new Error("ES error"));

			await adapter.pollESStatus();
			expect(adapter.log.warn.calledWithMatch(/ES.GetStatus failed/)).to.be.true;
			expect(adapter._pollFailureCount).to.equal(1);
		});

		it("pollESStatus resets failure count on success", async () => {
			adapter._pollFailureCount = 2;
			adapter.sendRequest = sandbox.stub().resolves({
				pv_power: 500,
				ongrid_power: 200,
				bat_power: -100,
				offgrid_power: 150,
			});

			await adapter.pollESStatus();
			expect(adapter._pollFailureCount).to.equal(0);
			expect(adapter.setState.calledWith("info.connection", { val: true, ack: true })).to.be.true;
		});

		it("pollESStatus marks disconnected after 3 failures", async () => {
			adapter._pollFailureCount = 2;
			adapter.sendRequest = sandbox.stub().rejects(new Error("ES error"));

			await adapter.pollESStatus();
			expect(adapter._pollFailureCount).to.equal(3);
			expect(adapter.setState.calledWith("info.connection", { val: false, ack: true })).to.be.true;
		});

		it("pollPVStatus updates all PV states", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				pv1_power: 500,
				pv1_voltage: 220,
				pv1_current: 2.3,
				pv1_state: 1,
				pv2_power: 300,
				pv2_voltage: 180,
				pv2_current: 1.5,
				pv2_state: 1,
				pv3_power: 0,
				pv3_voltage: 0,
				pv3_current: 0,
				pv3_state: 0,
				pv4_power: 0,
				pv4_voltage: 0,
				pv4_current: 0,
				pv4_state: 0,
			});

			await adapter.pollPVStatus();
			expect(adapter.setStateChangedAsync.callCount).to.equal(16);
			expect(adapter.setStateChangedAsync.calledWith("power.pv1", { val: 50, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv1Voltage", { val: 220, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv1Current", { val: 2.3, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv1State", { val: 1, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv2", { val: 300, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv2Voltage", { val: 180, ack: true })).to.be.true;
		});

		it("pollPVStatus handles partial response with some PVs active", async () => {
			adapter.sendRequest = sandbox.stub().resolves({
				pv1_power: 500,
				pv1_voltage: 220,
				pv1_current: 2.3,
				pv1_state: 1,
				pv2_power: null,
				pv2_voltage: null,
				pv2_current: null,
				pv2_state: null,
				pv3_power: undefined,
				pv3_voltage: undefined,
				pv3_current: undefined,
				pv3_state: undefined,
				pv4_power: 0,
				pv4_voltage: 0,
				pv4_current: 0,
				pv4_state: 0,
			});

			await adapter.pollPVStatus();
			expect(adapter.setStateChangedAsync.callCount).to.equal(8);
			expect(adapter.setStateChangedAsync.calledWith("power.pv1", { val: 50, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv1Voltage", { val: 220, ack: true })).to.be.true;
			expect(adapter.setStateChangedAsync.calledWith("power.pv1State", { val: 1, ack: true })).to.be.true;
		});

		it("pollPVStatus handles empty response", async () => {
			adapter.sendRequest = sandbox.stub().resolves({});

			await adapter.pollPVStatus();
			expect(adapter.setStateChangedAsync.callCount).to.equal(0);
		});
	});

	describe("onReady - discovery path", () => {
		beforeEach(async () => {
			adapter._socket = mockSocket;
		});

		it("runs discovery when autoDiscovery enabled and no IP", async () => {
			const adapter2 = Adapter({
				config: {
					autoDiscovery: true,
					ipAddress: "",
					udpPort: 30000,
					pollInterval: 10000,
				},
			});
			adapter2.discoverDevices = sandbox.stub().resolves();
			adapter2._pendingRequests.clear();
			adapter2._socket = mockSocket;

			await adapter2.onReady();
			expect(adapter2.discoverDevices.called).to.be.true;
		});

		it("logs configured device IP", async () => {
			adapter.log.info.resetHistory();
			adapter.config.ipAddress = "192.168.1.50";

			await adapter.onReady();

			expect(adapter.log.info.calledWithMatch(/192.168.1.50/)).to.be.true;
		});

		it("does not start polling when no IP and autoDiscovery disabled", async () => {
			const adapter3 = Adapter({
				config: {
					autoDiscovery: false,
					ipAddress: "",
					udpPort: 30000,
					pollInterval: 10000,
				},
			});
			adapter3._pendingRequests.clear();
			adapter3._pollingInProgress = false;
			adapter3._socket = mockSocket;

			await adapter3.onReady();
			expect(adapter3._normalPollTimer).to.be.null;
			expect(adapter3._slowPollTimer).to.be.null;
		});

		it("starts slow polling when IP is configured", async () => {
			adapter.startPolling();
			expect(adapter._slowPollTimer).to.not.be.null;
		});

		it("pollSlow calls all slow poll functions", async () => {
			adapter.pollWifiStatus = sandbox.stub().resolves();
			adapter.pollBLEStatus = sandbox.stub().resolves();

			await adapter.pollSlow();
			expect(adapter.pollWifiStatus.called).to.be.true;
			expect(adapter.pollBLEStatus.called).to.be.true;
		});
	});

	describe("onStateChange", () => {
		beforeEach(async () => {
			await adapter.onReady();
			if (adapter.fastPollInterval) {
				clearInterval(adapter.fastPollInterval);
			}
			if (adapter._normalPollTimer) {
				clearInterval(adapter._normalPollTimer);
			}
			if (adapter._slowPollTimer) {
				clearInterval(adapter._slowPollTimer);
			}
			adapter.fastPollInterval = null;
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter.sendRequest = sandbox.stub().resolves();
			adapter.sendRequest.resetHistory();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
			adapter.getStateAsync = sandbox.stub();
		});

		it("does nothing for acknowledged states", async () => {
			await adapter.onStateChange("control.mode", { val: "Auto", ack: true });
			expect(adapter.sendRequest.calledWith("ES.SetMode")).to.be.false;
		});

		it("does nothing for unknown state changes", async () => {
			await adapter.onStateChange("power.pv", { val: 100, ack: false });
			expect(adapter.sendRequest.calledWith("ES.SetMode")).to.be.false;
		});

		it("handles onStateChange errors gracefully", async () => {
			adapter.getStateAsync.rejects(new Error("State error"));

			try {
				await adapter.onStateChange("control.mode", { val: "Auto", ack: false });
			} catch {
				// Expected to throw
			}
			expect(adapter.log.error.calledWithMatch(/Failed to set/)).to.be.true;
		});

		it("updates passive control values when not in Manual mode", async () => {
			adapter.getStateAsync = sandbox.stub();
			adapter.getStateAsync.withArgs("control.mode").resolves({ val: "Passive" });
			adapter.getStateAsync.withArgs("control.passivePower").resolves({ val: 500 });
			adapter.getStateAsync.withArgs("control.passiveDuration").resolves({ val: 600 });

			await adapter.onStateChange("control.passivePower", { val: 300, ack: false });

			expect(adapter.log.error.called).to.be.false;
		});

		it("handles null mode state", async () => {
			adapter.getStateAsync = sandbox.stub();
			adapter.getStateAsync.withArgs("control.mode").resolves(null);

			await adapter.onStateChange("control.passivePower", { val: 300, ack: false });

			expect(adapter.sendRequest.calledWith("ES.SetMode")).to.be.false;
		});

		it("updates Manual mode settings when manual control changes", async () => {
			adapter.getStateAsync = sandbox.stub();
			adapter.getStateAsync.withArgs("control.mode").resolves({ val: "Manual" });
			adapter.getStateAsync.withArgs("control.manualTimeNum").resolves({ val: 2 });
			adapter.getStateAsync.withArgs("control.manualStartTime").resolves({ val: "06:00" });
			adapter.getStateAsync.withArgs("control.manualEndTime").resolves({ val: "18:00" });
			adapter.getStateAsync.withArgs("control.manualWeekdays").resolves({ val: 65 });
			adapter.getStateAsync.withArgs("control.manualPower").resolves({ val: 2000 });
			adapter.getStateAsync.withArgs("control.manualEnable").resolves({ val: false });

			await adapter.onStateChange("control.manualPower", { val: 1500, ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						id: 0,
						config: sinon.match({
							mode: "Manual",
							manual_cfg: sinon.match({
								time_num: 2,
								start_time: "06:00",
								end_time: "18:00",
								week_set: 65,
								power: 2000,
								enable: 0,
							}),
						}),
					}),
				),
			).to.be.true;
		});

		it("does not update Manual settings when not in Manual mode", async () => {
			adapter.getStateAsync = sandbox.stub();
			adapter.getStateAsync.withArgs("control.mode").resolves({ val: "Auto" });

			await adapter.onStateChange("control.manualPower", { val: 1500, ack: false });

			expect(adapter.sendRequest.calledWith("ES.SetMode")).to.be.false;
		});

		it("handles missing manual control states with defaults", async () => {
			adapter.getStateAsync = sandbox.stub();
			adapter.getStateAsync.withArgs("control.mode").resolves({ val: "Manual" });
			adapter.getStateAsync.withArgs("control.manualTimeNum").resolves(null);
			adapter.getStateAsync.withArgs("control.manualStartTime").resolves(null);
			adapter.getStateAsync.withArgs("control.manualEndTime").resolves(null);
			adapter.getStateAsync.withArgs("control.manualWeekdays").resolves(null);
			adapter.getStateAsync.withArgs("control.manualPower").resolves(null);
			adapter.getStateAsync.withArgs("control.manualEnable").resolves(null);

			await adapter.onStateChange("control.manualTimeNum", { val: 1, ack: false });

			expect(
				adapter.sendRequest.calledWith(
					"ES.SetMode",
					sinon.match({
						config: sinon.match({
							manual_cfg: sinon.match({
								time_num: 0,
								start_time: "00:00",
								end_time: "23:59",
								week_set: 127,
								power: 100,
								enable: 0,
							}),
						}),
					}),
				),
			).to.be.true;
		});
	});

	describe("onUnload", () => {
		it("handles errors during cleanup", done => {
			adapter._socket = null;
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter._pendingRequests.clear();

			adapter.onUnload(() => {
				done();
			});
		});

		it("handles exception during cleanup", done => {
			adapter._socket = null;
			adapter._normalPollTimer = null;
			adapter._slowPollTimer = null;
			adapter._pendingRequests = null;

			adapter.onUnload(() => {
				done();
			});
		});
	});

	describe("discoverDevices()", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter._socket = { send: sandbox.stub().yields(null) };
			sandbox.stub(adapter, "setTimeout").callsFake(fn => {
				fn();
				return {};
			});
		});

		afterEach(() => {
			sandbox.restore();
		});

		it("sends one API-compliant discovery request to broadcast and multicast", async () => {
			await adapter.discoverDevices();
			expect(adapter._socket.send.callCount).to.equal(2);
			// Verify broadcast (255.255.255.255) and multicast (239.255.255.250) are called for the single attempt
			const calls = adapter._socket.send.getCalls();
			expect(calls.length).to.equal(2);

			const payload = JSON.parse(calls[0].args[0].toString());
			expect(payload.method).to.equal("Marstek.GetDevice");
			expect(payload.params).to.deep.equal({ ble_mac: "0" });
		});

		it("handles broadcast send errors gracefully", async () => {
			adapter._socket.send.onFirstCall().yields(new Error("Broadcast failed"));
			await adapter.discoverDevices();
			expect(adapter.log.error.calledOnce).to.be.true;
		});

		it("handles multicast send errors as debug only", async () => {
			adapter._socket.send.onSecondCall().yields(new Error("Multicast failed"));
			await adapter.discoverDevices();
			expect(adapter.log.debug.called).to.be.true;
			expect(adapter.log.error.called).to.be.false;
		});

		it("catches exceptions during discovery attempts", async () => {
			adapter._socket.send.throws(new Error("Send exception"));
			await adapter.discoverDevices();
			expect(adapter.log.error.called).to.be.true;
		});
	});

	describe("setControlTarget", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter.sendRequest = sandbox.stub().resolves();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("handles valid control values", async () => {
			await adapter.setControlTarget(150);
			expect(adapter.sendRequest.calledWith("Marstek.SetTargetPower", { power: 150 })).to.be.true;
		});

		it("clamps values within min/max range", async () => {
			await adapter.setControlTarget(-2000);
			expect(adapter.sendRequest.calledWith("Marstek.SetTargetPower", { power: -1500 })).to.be.true;

			await adapter.setControlTarget(2000);
			expect(adapter.sendRequest.calledWith("Marstek.SetTargetPower", { power: 1500 })).to.be.true;
		});

		it("ignores null and undefined values", async () => {
			await adapter.setControlTarget(null);
			expect(adapter.sendRequest.calledWith("Marstek.SetTargetPower")).to.be.false;
		});
	});

	describe("sendRequest PLACEHOLDER handling", () => {
		beforeEach(async () => {
			await adapter.onReady();
			clock.tick(2000);
			if (adapter._normalPollTimer) {
				clearInterval(adapter._normalPollTimer);
				adapter._normalPollTimer = null;
			}
			if (adapter._slowPollTimer) {
				clearInterval(adapter._slowPollTimer);
				adapter._slowPollTimer = null;
			}
			if (adapter._fastPollTimer) {
				clearInterval(adapter._fastPollTimer);
				adapter._fastPollTimer = null;
			}
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
			adapter._requestQueue._shuttingDown = false;
			adapter._requestQueue.queue = [];
			adapter._requestQueue._busy = false;
		});

		it("returns existing promise when method already pending", async () => {
			const expectedResult = { result: "existing" };
			const existingPromise = Promise.resolve(expectedResult);
			adapter._pendingRequestsByMethod.set("Test.Unique.Method.123", existingPromise);

			const resultPromise = adapter.sendRequest("Test.Unique.Method.123", {});

			expect(resultPromise).to.be.instanceOf(Promise);
			const result = await resultPromise;
			expect(result).to.deep.equal(expectedResult);
			expect(adapter.log.debug.calledWithMatch(/already pending/)).to.be.true;
		});

		it("waits for PLACEHOLDER to be replaced when method has PLACEHOLDER", async () => {
			adapter._pendingRequestsByMethod.set("Test.Unique.Method.456", Symbol("pending"));

			const resultPromise = adapter.sendRequest("Test.Unique.Method.456", {});

			expect(resultPromise).to.be.instanceOf(Promise);

			const updatedResult = { result: "updated" };
			adapter._pendingRequestsByMethod.set("Test.Unique.Method.456", Promise.resolve(updatedResult));

			clock.tick(500);
		});
	});

	describe("startPolling", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("clears existing _normalPollTimer before creating new one", () => {
			const oldTimer = adapter._normalPollTimer;
			expect(oldTimer).to.not.be.null;

			const clearIntervalSpy = sandbox.spy(adapter, "clearInterval");
			const setIntervalSpy = sandbox.spy(adapter, "setInterval");
			const startFastPollingSpy = sandbox.spy(adapter, "startFastPolling");
			const startSlowPollingSpy = sandbox.spy(adapter, "startSlowPolling");
			const pollSpy = sandbox.spy(adapter, "poll");

			adapter.startPolling();

			expect(clearIntervalSpy.calledWith(oldTimer)).to.be.true;
			expect(setIntervalSpy.called).to.be.true;
			expect(adapter._normalPollTimer).to.not.be.null;
			expect(startFastPollingSpy.calledOnce).to.be.true;
			expect(startSlowPollingSpy.calledOnce).to.be.true;
			expect(pollSpy.calledOnce).to.be.true;
		});
	});

	describe("startSlowPolling", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("clears existing _slowPollTimer before creating new one", () => {
			const oldTimer = adapter._slowPollTimer;
			expect(oldTimer).to.not.be.null;

			const clearIntervalSpy = sandbox.spy(adapter, "clearInterval");
			const setIntervalSpy = sandbox.spy(adapter, "setInterval");
			const pollSlowSpy = sandbox.spy(adapter, "pollSlow");

			adapter.startSlowPolling();

			expect(clearIntervalSpy.calledWith(oldTimer)).to.be.true;
			expect(setIntervalSpy.called).to.be.true;
			expect(adapter._slowPollTimer).to.not.be.null;
			expect(pollSlowSpy.calledOnce).to.be.true;
		});
	});

	describe("startFastPolling", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("clears existing _fastPollTimer before creating new one", () => {
			const oldTimer = adapter._fastPollTimer;
			if (oldTimer) {
				const clearIntervalSpy = sandbox.spy(adapter, "clearInterval");
				const setIntervalSpy = sandbox.spy(adapter, "setInterval");
				const pollESStatusSpy = sandbox.spy(adapter, "pollESStatus");

				adapter.startFastPolling();

				expect(clearIntervalSpy.calledWith(oldTimer)).to.be.true;
				expect(setIntervalSpy.called).to.be.true;
				expect(adapter._fastPollTimer).to.not.be.null;
				expect(pollESStatusSpy.calledOnce).to.be.true;
			}
		});
	});

	describe("onMessage setSettings", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("sends success response for setSettings command", async () => {
			const msgObj = {
				command: "setSettings",
				from: "admin.0",
				values: {
					autoDiscovery: true,
					ipAddress: "192.168.1.100",
					udpPort: 5000,
					pollInterval: 5000,
				},
				callback: sandbox.stub(),
			};

			await adapter.onMessage(msgObj);

			expect(adapter.sendTo.called).to.be.true;
			expect(adapter.sendTo.firstCall.args[0]).to.equal("admin.0");
			expect(adapter.sendTo.firstCall.args[1]).to.equal("setSettings");
			expect(adapter.sendTo.firstCall.args[2]).to.deep.equal({ success: true });
			expect(adapter.sendTo.firstCall.args[3]).to.equal(msgObj.callback);
		});
	});

	describe("onUnload cleanup", () => {
		beforeEach(async () => {
			await adapter.onReady();
			adapter._pendingRequests.clear();
			adapter._pendingRequestsByMethod = new Map();
		});

		it("clears _fastPollTimer", () => {
			const clearIntervalSpy = sandbox.spy(adapter, "clearInterval");
			adapter._fastPollTimer = 111;

			adapter.onUnload(sandbox.stub());

			expect(clearIntervalSpy.calledWith(111)).to.be.true;
		});

		it("clears _slowPollTimer", () => {
			const clearIntervalSpy = sandbox.spy(adapter, "clearInterval");
			adapter._slowPollTimer = 222;

			adapter.onUnload(sandbox.stub());

			expect(clearIntervalSpy.calledWith(222)).to.be.true;
		});

		it("clears _normalPollTimer", () => {
			const clearIntervalSpy = sandbox.spy(adapter, "clearInterval");
			adapter._normalPollTimer = 333;

			adapter.onUnload(sandbox.stub());

			expect(clearIntervalSpy.calledWith(333)).to.be.true;
		});

		it("clears _requestQueue", () => {
			const clearStub = sandbox.stub();
			adapter._requestQueue = { clear: clearStub };

			adapter.onUnload(sandbox.stub());

			expect(clearStub.calledOnce).to.be.true;
		});

		it("closes socket", () => {
			const closeStub = sandbox.stub();
			adapter._socket = { close: closeStub };

			adapter.onUnload(sandbox.stub());

			expect(closeStub.calledOnce).to.be.true;
		});

		it("rejects pending requests with shutdown error", () => {
			const rejectStub = sandbox.stub();
			adapter._pendingRequests.set("req1", {
				timeout: null,
				reject: rejectStub,
				resolve: sandbox.stub(),
			});

			adapter.onUnload(sandbox.stub());

			expect(rejectStub.calledOnce).to.be.true;
			expect(rejectStub.firstCall.args[0].message).to.equal("Adapter shutting down");
			expect(adapter._pendingRequests.size).to.equal(0);
		});

		it("always calls callback even on error", () => {
			adapter._requestQueue = null;
			adapter._socket = null;

			const callbackSpy = sandbox.stub();

			adapter.onUnload(callbackSpy);

			expect(callbackSpy.calledOnce).to.be.true;
		});
	});

	describe("copyMethods helper", () => {
		// Exact implementation from main.js for testing
		function copyMethods(target, source) {
			if (!source) {
				return;
			}
			if (source.prototype && Object.getPrototypeOf(source.prototype)) {
				// It's a class - copy from prototype
				Object.defineProperties(target, Object.getOwnPropertyDescriptors(source.prototype));
			} else {
				// It's a plain object - copy directly
				Object.assign(target, source);
			}
		}

		it("handles null source gracefully", () => {
			const target = {};
			expect(() => {
				copyMethods(target, null);
			}).to.not.throw();
			expect(target).to.deep.equal({});
		});

		it("handles undefined source gracefully", () => {
			const target = {};
			expect(() => {
				copyMethods(target, undefined);
			}).to.not.throw();
			expect(target).to.deep.equal({});
		});

		it("copies properties from plain object source", () => {
			const target = {};
			const source = {
				testProp: 123,
				testMethod: () => "hello",
			};

			copyMethods(target, source);

			expect(target.testProp).to.equal(123);
			expect(target.testMethod()).to.equal("hello");
		});

		it("copies methods from class prototype source", () => {
			const target = {};
			class TestClass {
				testMethod() {
					return "from class";
				}
			}

			copyMethods(target, TestClass);

			expect(target.testMethod).to.be.a("function");
			expect(target.testMethod()).to.equal("from class");
		});

		it("does not modify target when source is null", () => {
			const target = { existing: "value" };
			copyMethods(target, null);
			expect(target).to.deep.equal({ existing: "value" });
		});

		it("does not modify target when source is undefined", () => {
			const target = { existing: "value" };
			copyMethods(target, undefined);
			expect(target).to.deep.equal({ existing: "value" });
		});
	});

	describe("module exports", () => {
		it("exports MarstekVenusAdapter class", () => {
			expect(MarstekVenusAdapter).to.be.a("function");
		});

		it("exports createAdapter factory function", () => {
			expect(MarstekVenusAdapter.createAdapter).to.be.a("function");
		});

		it("createAdapter returns instance", () => {
			const instance = MarstekVenusAdapter.createAdapter({});
			expect(instance).to.be.instanceOf(MarstekVenusAdapter);
		});
	});
});
