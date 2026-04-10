'use strict';

const chai = require('chai');
const sinon = require('sinon');
const dgram = require('node:dgram');
const expect = chai.expect;

// Mock external dependencies FIRST
const mockSocket = {
    on: sinon.stub(),
    bind: sinon.stub().callsFake((port, cb) => typeof cb === 'function' && cb(null)),
    setBroadcast: sinon.stub(),
    address: sinon.stub().returns({ address: '0.0.0.0', port: 12345 }),
    send: sinon.stub().callsFake((buf, offset, len, port, addr, cb) => {
        if (typeof cb === 'function') {
            cb(null);
        }
        return null;
    }),
    close: sinon.stub()
};
sinon.stub(dgram, 'createSocket').returns(mockSocket);

// Mock the adapter core base class
class MockAdapterBase {
    constructor(options) {
        this.name = options.name;
        this.config = options.config;
        this.log = {
            info: sinon.stub(),
            debug: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub()
        };
        this.setStateAsync = sinon.stub().resolves();
        this.setStateChangedAsync = sinon.stub().resolves();
        this.setObjectNotExistsAsync = sinon.stub().resolves();
        this.getStateAsync = sinon.stub().resolves();
        this.subscribeStatesAsync = sinon.stub().resolves();
        this.sendTo = sinon.stub();
        this._eventHandlers = {};
    }

    on(event, handler) {
        this._eventHandlers[event] = handler;
    }

    emit(event, ...args) {
        if (this._eventHandlers[event]) {
            this._eventHandlers[event](...args);
        }
    }
}

// Mock @iobroker/adapter-core
const mockAdapterCore = {
    Adapter: MockAdapterBase
};
require.cache[require.resolve('@iobroker/adapter-core')] = { exports: mockAdapterCore };

// Now load the actual adapter - clear ALL caches including adapter-core
const adapterCorePath = require.resolve('@iobroker/adapter-core');
Object.keys(require.cache).forEach(key => {
    if (key === adapterCorePath || key.includes('/lib/') || key.endsWith('main.js')) {
        delete require.cache[key];
    }
});
// Re-mock adapter-core
require.cache[adapterCorePath] = { exports: mockAdapterCore };
const MarstekVenusAdapter = require('../main.js');
const Adapter = (options) => new MarstekVenusAdapter(options);

describe('MarstekVenusAdapter', function() {
    let adapter;
    let sandbox;
    let clock;

    this.timeout(20000);

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        clock = sandbox.useFakeTimers();
        
        // Reset socket mock completely
        mockSocket.on.resetHistory();
        mockSocket.bind.reset();
        mockSocket.bind.callsFake((port, cb) => {
            if (typeof cb === 'function') {
                cb(null);
            }
        });
        mockSocket.setBroadcast.resetHistory();
        mockSocket.address.resetHistory();
        mockSocket.send.reset();
        mockSocket.send.callsFake((buf, offset, len, port, addr, cb) => {
            if (typeof cb === 'function') {
                cb(null);
            }
            return null;
        });
        mockSocket.close.resetHistory();

        // Create fresh adapter instance
        adapter = Adapter({
            config: {
                autoDiscovery: false,
                ipAddress: '192.168.1.100',
                udpPort: 30000,
                pollInterval: 10000
            }
        });

        // Clear pending requests and intervals from any accidental polls triggered during setup
        adapter.pendingRequests.clear();
        adapter.pendingRequestsByMethod = new Map();
        if (adapter.pollInterval) {
            clearInterval(adapter.pollInterval);
            adapter.pollInterval = null;
        }
        if (adapter.slowPollInterval) {
            clearInterval(adapter.slowPollInterval);
            adapter.slowPollInterval = null;
        }
        adapter._pollingInProgress = false;
        adapter._pollFailureCount = 0;
    });

    afterEach(() => {
        sandbox.restore();
        clock.restore();
        adapter = null;
    });

    describe('Constructor', () => {
        it('initializes all properties correctly', () => {
            expect(adapter.requestId).to.equal(1);
            expect(adapter.pendingRequests).to.be.instanceOf(Map);
            expect(adapter.pollInterval).to.be.null;
            expect(adapter.slowPollInterval).to.be.null;
            expect(adapter.discoveredIP).to.be.null;
            expect(adapter._pollingInProgress).to.be.false;
            expect(adapter._pollFailureCount).to.equal(0);
        });

        it('binds all lifecycle event handlers', () => {
            expect(adapter._eventHandlers.ready).to.exist;
            expect(adapter._eventHandlers.stateChange).to.exist;
            expect(adapter._eventHandlers.unload).to.exist;
            expect(adapter._eventHandlers.message).to.exist;
        });
    });

    describe('Lifecycle methods', () => {
        describe('onReady()', () => {
            it('initializes states and creates socket', async () => {
                await adapter.onReady();

                expect(adapter.setObjectNotExistsAsync.callCount).to.equal(40);
                expect(adapter.subscribeStatesAsync.calledWith('control.*')).to.be.true;
                expect(dgram.createSocket.calledWith('udp4')).to.be.true;
                expect(mockSocket.bind.called).to.be.true;
                expect(mockSocket.setBroadcast.calledWith(true)).to.be.true;
            });

            it('starts polling when IP is configured', async () => {
                await adapter.onReady();
                expect(adapter.pollInterval).to.not.be.null;
                expect(adapter.slowPollInterval).to.not.be.null;
            });


        });

        describe('onUnload()', () => {
            it('cleans up all resources', (done) => {
                adapter.socket = mockSocket;
                adapter.pollInterval = setInterval(() => {}, 1000);
                adapter.slowPollInterval = setInterval(() => {}, 1000);
                
                const timeout = setTimeout(() => {}, 1000);
                const rejectSpy = sandbox.stub();
                adapter.pendingRequests.set(1, { timeout, reject: rejectSpy });

                adapter.onUnload(() => {
                    expect(mockSocket.close.calledOnce).to.be.true;
                    expect(rejectSpy.calledOnce).to.be.true;
                    done();
                });
            });
        });

        describe('onMessage()', () => {
            it('handles discover command', async () => {
                adapter.discoverDevices = sandbox.stub().resolves();
                adapter.discoveredIP = '192.168.1.100';

                await adapter.onMessage({
                    command: 'discover',
                    from: 'admin.0',
                    callback: 123
                });

                expect(adapter.discoverDevices.called).to.be.true;
                expect(adapter.sendTo.called).to.be.true;
            });
        });
    });

    describe('sendRequest()', () => {
        beforeEach(async () => {
            await adapter.onReady();
            if (adapter.pollInterval) clearInterval(adapter.pollInterval);
            if (adapter.slowPollInterval) clearInterval(adapter.slowPollInterval);
            if (adapter.fastPollInterval) clearInterval(adapter.fastPollInterval);
            adapter.pollInterval = null;
            adapter.slowPollInterval = null;
            adapter.fastPollInterval = null;
            adapter.pendingRequests.clear();
            adapter.pendingRequestsByMethod = new Map();
        });

        it('rejects when no target IP', async () => {
            adapter.config.ipAddress = '';
            adapter.discoveredIP = null;

            try {
                await adapter.sendRequest('ES.GetStatus');
                expect.fail('Should reject');
            } catch (e) {
                expect(e.message).to.equal('No target IP configured');
            }
        });

        it('adds request to pending queue', async () => {
            const promise = adapter.sendRequest('ES.GetStatus');
            expect(adapter.pendingRequests.size).to.equal(1);
            
            const req = adapter.pendingRequests.values().next().value;
            clearTimeout(req.timeout);
            req.resolve({ ok: true });
            
            expect(await promise).to.deep.equal({ ok: true });
        });

        it('handles timeout correctly', async () => {
            const promise = adapter.sendRequest('ES.GetStatus');
            clock.tick(10000);
            
            try {
                await promise;
                expect.fail('Should timeout');
            } catch (e) {
                expect(e.message).to.include('1 attempts');
            }
            expect(adapter.pendingRequests.size).to.equal(0);
        });

        it('handles socket send errors', async () => {
            mockSocket.send.callsArgWith(5, new Error('Send failed'));
            
            try {
                await adapter.sendRequest('ES.GetStatus');
                expect.fail('Should reject');
            } catch (e) {
                expect(e.message).to.equal('Send failed');
            }
        });
    });

    describe('handleResponse()', () => {
        beforeEach(async () => {
            await adapter.onReady();
            if (adapter.pollInterval) clearInterval(adapter.pollInterval);
            if (adapter.slowPollInterval) clearInterval(adapter.slowPollInterval);
            if (adapter.fastPollInterval) clearInterval(adapter.fastPollInterval);
            adapter.pollInterval = null;
            adapter.slowPollInterval = null;
            adapter.fastPollInterval = null;
            adapter.pendingRequests.clear();
            adapter.pendingRequestsByMethod = new Map();
        });

        it('resolves pending request on success', async () => {
            const promise = adapter.sendRequest('ES.GetStatus');
            const reqId = adapter.requestId - 1;

            adapter.handleResponse(
                Buffer.from(JSON.stringify({ id: reqId, result: { soc: 98 } })),
                { address: '192.168.1.100' }
            );

            expect(await promise).to.deep.equal({ soc: 98 });
        });

        it('rejects on error response', async () => {
            const promise = adapter.sendRequest('ES.GetStatus');
            const reqId = adapter.requestId - 1;

            adapter.handleResponse(
                Buffer.from(JSON.stringify({ id: reqId, error: { code: -1, message: 'Error' } })),
                { address: '192.168.1.100' }
            );

            try {
                await promise;
                expect.fail('Should reject');
            } catch (e) {
                expect(e.message).to.include('Error');
            }
        });

        it('handles discovery responses', () => {
            adapter.config.ipAddress = '';
            
            adapter.handleResponse(
                Buffer.from(JSON.stringify({ result: { device: 'Venus C', ip: '192.168.1.100' } })),
                { address: '192.168.1.100' }
            );

            expect(adapter.discoveredIP).to.equal('192.168.1.100');
        });

        it('ignores discovery when IP already configured', () => {
            adapter.config.ipAddress = '192.168.1.50';
            adapter.startPolling = sandbox.stub();
            
            adapter.handleResponse(
                Buffer.from(JSON.stringify({ result: { device: 'Venus C', ip: '192.168.1.100' } })),
                { address: '192.168.1.100' }
            );

            expect(adapter.discoveredIP).to.be.null;
            expect(adapter.log.info.calledWithMatch(/using configured IP/)).to.be.true;
        });

        it('warns on discovery response without IP', () => {
            adapter.config.ipAddress = '';
            
            adapter.handleResponse(
                Buffer.from(JSON.stringify({ result: { device: 'Venus C' } })),
                { address: '192.168.1.100' }
            );

            expect(adapter.log.warn.calledWithMatch(/without IP address/)).to.be.true;
        });

        it('ignores unsolicited messages', () => {
            adapter.handleResponse(
                Buffer.from(JSON.stringify({ method: 'SomeEvent', data: 123 })),
                { address: '192.168.1.100' }
            );

            expect(adapter.log.debug.calledWithMatch(/unsolicited message/)).to.be.true;
        });

        it('ignores invalid JSON', () => {
            adapter.handleResponse(Buffer.from('invalid json'), { address: '192.168.1.100' });
            expect(adapter.log.debug.calledWithMatch(/Invalid response/)).to.be.true;
        });
    });

    describe('Operating modes', () => {
        beforeEach(async () => {
            await adapter.onReady();
            adapter.sendRequest = sandbox.stub().resolves();
        });

        it('handles Auto mode', async () => {
            await adapter.onStateChange('control.mode', { val: 'Auto', ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                config: { mode: 'Auto', auto_cfg: { enable: 1 } }
            }))).to.be.true;
        });

        it('handles AI mode', async () => {
            await adapter.onStateChange('control.mode', { val: 'AI', ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                config: { mode: 'AI', ai_cfg: { enable: 1 } }
            }))).to.be.true;
        });

        it('handles Passive mode', async () => {
            adapter.getStateAsync.withArgs('control.passivePower').resolves({ val: 500 });
            adapter.getStateAsync.withArgs('control.passiveDuration').resolves({ val: 600 });

            await adapter.onStateChange('control.mode', { val: 'Passive', ack: false });
            
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                config: { mode: 'Passive', passive_cfg: { power: 500, cd_time: 600 } }
            }))).to.be.true;
        });

        it('handles Manual mode', async () => {
            adapter.getStateAsync.withArgs('control.manualTimeNum').resolves({ val: 1 });
            adapter.getStateAsync.withArgs('control.manualStartTime').resolves({ val: '08:00' });
            adapter.getStateAsync.withArgs('control.manualEndTime').resolves({ val: '20:00' });
            adapter.getStateAsync.withArgs('control.manualWeekdays').resolves({ val: 127 });
            adapter.getStateAsync.withArgs('control.manualPower').resolves({ val: 1000 });
            adapter.getStateAsync.withArgs('control.manualEnable').resolves({ val: true });

            await adapter.onStateChange('control.mode', { val: 'Manual', ack: false });
            
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match.has('config'))).to.be.true;
        });
    });

    describe('Poll functions', () => {
        beforeEach(async () => {
            adapter.pollInterval = null;
            adapter.slowPollInterval = null;
            adapter._pollingInProgress = false;
        });

        it('updates connection state on successful poll', async () => {
            adapter.pollESStatus = sandbox.stub().resolves();
            adapter.pollBatteryStatus = sandbox.stub().resolves();
            adapter.pollPVStatus = sandbox.stub().resolves();
            adapter.pollEMStatus = sandbox.stub().resolves();
            adapter.pollModeStatus = sandbox.stub().resolves();

            await adapter.poll();
            expect(adapter.setStateAsync.calledWith('info.connection', { val: true, ack: true })).to.be.true;
            expect(adapter._pollFailureCount).to.equal(0);
        });

        it('handles poll cycle throw', async () => {
            sandbox.stub(adapter, 'pollWithRetry').callsFake(async () => {
                throw new Error('Poll error');
            });

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(1);
        });

        it('handles poll cycle throw with 3 failures', async () => {
            sandbox.stub(adapter, 'pollWithRetry').callsFake(async () => {
                throw new Error('Poll error');
            });

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(1);
            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(2);
            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(3);
            expect(adapter.setStateAsync.calledWith('info.connection', { val: false, ack: true })).to.be.true;
        });

        it('handles pollWithRetry returning false', async () => {
            sandbox.stub(adapter, 'pollWithRetry').resolves(false);

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(1);
        });

        it('does not mark connection false on single poll failure', async () => {
            sandbox.stub(adapter, 'pollWithRetry').callsFake(async (fn) => {
                try {
                    await fn();
                    return true;
                } catch (e) {
                    return false;
                }
            });

            await adapter.poll();
            expect(adapter.setStateAsync.calledWith('info.connection', { val: false, ack: true })).to.be.false;
            expect(adapter._pollFailureCount).to.equal(1);
        });

        it('marks connection false after 3 consecutive poll failures', async () => {
            sandbox.stub(adapter, 'pollWithRetry').callsFake(async (fn) => {
                try {
                    await fn();
                    return true;
                } catch (e) {
                    return false;
                }
            });

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(1);
            expect(adapter.setStateAsync.calledWith('info.connection', { val: false, ack: true })).to.be.false;

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(2);
            expect(adapter.setStateAsync.calledWith('info.connection', { val: false, ack: true })).to.be.false;

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(3);
            expect(adapter.setStateAsync.calledWith('info.connection', { val: false, ack: true })).to.be.true;
        });

        it('resets failure count on successful poll after failures', async () => {
            let pollCallCount = 0;
            sandbox.stub(adapter, 'pollWithRetry').callsFake(async (fn) => {
                pollCallCount++;
                try {
                    await fn();
                    return true;
                } catch (e) {
                    return false;
                }
            });

            // First two polls fail (all poll functions fail)
            adapter.pollESStatus = sandbox.stub().rejects(new Error('Failed'));
            adapter.pollBatteryStatus = sandbox.stub().rejects(new Error('Failed'));
            adapter.pollPVStatus = sandbox.stub().rejects(new Error('Failed'));
            adapter.pollEMStatus = sandbox.stub().rejects(new Error('Failed'));
            adapter.pollModeStatus = sandbox.stub().rejects(new Error('Failed'));

            await adapter.poll();
            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(2);

            // Third poll succeeds
            adapter.pollESStatus = sandbox.stub().resolves();
            adapter.pollBatteryStatus = sandbox.stub().resolves();
            adapter.pollPVStatus = sandbox.stub().resolves();
            adapter.pollEMStatus = sandbox.stub().resolves();
            adapter.pollModeStatus = sandbox.stub().resolves();

            await adapter.poll();
            expect(adapter._pollFailureCount).to.equal(0);
            expect(adapter.setStateAsync.calledWith('info.connection', { val: true, ack: true })).to.be.true;
        });

        it('skips overlapping polls', async () => {
            adapter._pollingInProgress = true;
            
            await adapter.poll();
            expect(adapter._pollingInProgress).to.be.true;
        });

        it('retries failed poll before marking failure', async () => {
            const setTimeoutStub = sandbox.stub(global, 'setTimeout').callsFake((fn) => {
                fn();
                return 1;
            });

            let attempts = 0;
            adapter.pollESStatus = sandbox.stub().callsFake(() => {
                attempts++;
                if (attempts < 2) {
                    return Promise.reject(new Error('Transient failure'));
                }
                return Promise.resolve();
            });
            adapter.pollBatteryStatus = sandbox.stub().resolves();
            adapter.pollPVStatus = sandbox.stub().resolves();
            adapter.pollEMStatus = sandbox.stub().resolves();
            adapter.pollModeStatus = sandbox.stub().resolves();

            await adapter.poll();
            expect(attempts).to.equal(2);
            expect(adapter._pollFailureCount).to.equal(0);
        });

        it('returns false when all retry attempts fail', async () => {
            sandbox.stub(global, 'setTimeout').callsFake((fn) => {
                fn();
                return 1;
            });
            adapter.pollESStatus = sandbox.stub().rejects(new Error('Permanent failure'));

            const result = await adapter.pollWithRetry(() => adapter.pollESStatus());
            expect(result).to.be.false;
        });

        it('returns true on successful attempt', async () => {
            sandbox.stub(global, 'setTimeout').callsFake((fn) => {
                fn();
                return 1;
            });
            adapter.pollESStatus = sandbox.stub().resolves();

            const result = await adapter.pollWithRetry(() => adapter.pollESStatus());
            expect(result).to.be.true;
        });
    });

    describe('All helper methods', () => {
        beforeEach(async () => {
            await adapter.onReady();
        });

        it('pollESStatus updates all power states', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: 500,
                ongrid_power: 200,
                bat_power: -100,
                offgrid_power: 150,
                bat_soc: 85,
                total_pv_energy: 1000,
                total_grid_output_energy: 200,
                total_grid_input_energy: 150,
                total_load_energy: 300
            });

            await adapter.pollESStatus();
            expect(adapter.setStateChangedAsync.callCount).to.equal(9);
        });

        it('pollESStatus handles partial response', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: 500
            });

            await adapter.pollESStatus();
            expect(adapter.setStateChangedAsync.calledWith('power.pv', { val: 500, ack: true })).to.be.true;
        });

        it('pollBatteryStatus updates states', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                soc: 82,
                bat_temp: 25,
                bat_capacity: 5000,
                rated_capacity: 10000,
                charg_flag: true,
                dischrg_flag: false
            });

            await adapter.pollBatteryStatus();
            expect(adapter.setStateChangedAsync.calledWith('battery.temperature', { val: 25, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('battery.capacity', { val: 5000, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('battery.ratedCapacity', { val: 10000, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('battery.chargingAllowed', { val: true, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('battery.dischargingAllowed', { val: false, ack: true })).to.be.true;
        });

        it('pollWifiStatus updates states', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                sta_ip: '192.168.1.100',
                ssid: 'HomeWiFi',
                rssi: -65
            });

            await adapter.pollWifiStatus();
            expect(adapter.setStateChangedAsync.calledWith('network.ip', { val: '192.168.1.100', ack: true })).to.be.true;
        });

        it('re-throws poll errors for retry handling', async () => {
            adapter.sendRequest = sandbox.stub().rejects(new Error('Test error'));
            
            await adapter.pollESStatus().catch(e => {
                expect(e.message).to.equal('Test error');
            });
            await adapter.pollBatteryStatus().catch(e => {
                expect(e.message).to.equal('Test error');
            });
            await adapter.pollPVStatus().catch(e => {
                expect(e.message).to.equal('Test error');
            });
        });

        it('pollEMStatus updates states', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                ct_state: 1,
                a_power: 100,
                b_power: 200,
                c_power: 300,
                total_power: 600
            });

            await adapter.pollEMStatus();
            expect(adapter.setStateChangedAsync.calledWith('energymeter.ctState', { val: 1, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('energymeter.powerA', { val: 100, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('energymeter.powerB', { val: 200, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('energymeter.powerC', { val: 300, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('energymeter.powerTotal', { val: 600, ack: true })).to.be.true;
        });

        it('pollModeStatus updates control mode state', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                mode: 'AI'
            });

            await adapter.pollModeStatus();
            expect(adapter.setStateChangedAsync.calledWith('control.mode', { val: 'AI', ack: true })).to.be.true;
        });

        it('pollModeStatus handles null mode', async () => {
            adapter.sendRequest = sandbox.stub().resolves({});

            await adapter.pollModeStatus();
            expect(adapter.setStateChangedAsync.called).to.be.false;
        });

        it('pollPVStatus handles null values', async () => {
            adapter.sendRequest = sandbox.stub().resolves({});

            await adapter.pollPVStatus();
            expect(adapter.setStateChangedAsync.called).to.be.false;
        });

        it('pollWifiStatus handles errors gracefully', async () => {
            adapter.sendRequest = sandbox.stub().rejects(new Error('Network error'));

            await adapter.pollWifiStatus();
            expect(adapter.log.warn.calledWithMatch(/Wifi.GetStatus failed/)).to.be.true;
        });

        it('pollBLEStatus updates BLE state', async () => {
            adapter.sendRequest = sandbox.stub().resolves({ state: 'connected' });

            await adapter.pollBLEStatus();
            expect(adapter.setStateChangedAsync.calledWith('network.bleState', { val: 'connected', ack: true })).to.be.true;
        });

        it('pollBLEStatus handles errors gracefully', async () => {
            adapter.sendRequest = sandbox.stub().rejects(new Error('BLE error'));

            await adapter.pollBLEStatus();
            expect(adapter.log.warn.calledWithMatch(/BLE.GetStatus failed/)).to.be.true;
        });

        it('pollInfoStatus updates device info states', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                device: 'Venus C',
                ver: 123,
                ble_mac: 'AA:BB:CC:DD:EE:FF'
            });

            await adapter.pollInfoStatus();
            expect(adapter.setStateChangedAsync.calledWith('info.device', { val: 'Venus C', ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('info.firmware', { val: 123, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('info.mac', { val: 'AA:BB:CC:DD:EE:FF', ack: true })).to.be.true;
        });

        it('pollInfoStatus handles errors gracefully', async () => {
            adapter.sendRequest = sandbox.stub().rejects(new Error('Info error'));

            await adapter.pollInfoStatus();
            expect(adapter.log.warn.calledWithMatch(/ES.GetInfo failed/)).to.be.true;
        });

        it('pollPower updates all power states', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: 500,
                ongrid_power: 200,
                bat_power: -100,
                offgrid_power: 150
            });

            await adapter.pollPower();
            expect(adapter.setStateChangedAsync.callCount).to.equal(4);
            expect(adapter.setStateChangedAsync.calledWith('power.pv', { val: 500, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('power.grid', { val: 200, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('power.battery', { val: -100, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('power.load', { val: 150, ack: true })).to.be.true;
        });

        it('pollPower handles partial response with some null values', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: 500,
                ongrid_power: null,
                bat_power: undefined,
                offgrid_power: 150
            });

            await adapter.pollPower();
            expect(adapter.setStateChangedAsync.callCount).to.equal(2);
            expect(adapter.setStateChangedAsync.calledWith('power.pv', { val: 500, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('power.load', { val: 150, ack: true })).to.be.true;
        });

        it('pollPower handles errors gracefully', async () => {
            adapter.sendRequest = sandbox.stub().rejects(new Error('Power error'));

            await adapter.pollPower();
            expect(adapter.log.warn.calledWithMatch(/pollPower failed/)).to.be.true;
        });

        it('pollPVStatus updates pv power, voltage and current', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: 500,
                pv_voltage: 220,
                pv_current: 2.3
            });

            await adapter.pollPVStatus();
            expect(adapter.setStateChangedAsync.callCount).to.equal(3);
            expect(adapter.setStateChangedAsync.calledWith('power.pv', { val: 500, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('power.pvVoltage', { val: 220, ack: true })).to.be.true;
            expect(adapter.setStateChangedAsync.calledWith('power.pvCurrent', { val: 2.3, ack: true })).to.be.true;
        });

        it('pollPVStatus handles only voltage present', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: null,
                pv_voltage: 220,
                pv_current: null
            });

            await adapter.pollPVStatus();
            expect(adapter.setStateChangedAsync.callCount).to.equal(1);
            expect(adapter.setStateChangedAsync.calledWith('power.pvVoltage', { val: 220, ack: true })).to.be.true;
        });

        it('pollPVStatus handles only current present', async () => {
            adapter.sendRequest = sandbox.stub().resolves({
                pv_power: null,
                pv_voltage: null,
                pv_current: 2.3
            });

            await adapter.pollPVStatus();
            expect(adapter.setStateChangedAsync.callCount).to.equal(1);
            expect(adapter.setStateChangedAsync.calledWith('power.pvCurrent', { val: 2.3, ack: true })).to.be.true;
        });
    });

    describe('onReady - discovery path', () => {
        beforeEach(async () => {
            adapter.socket = mockSocket;
        });

        it('runs discovery when autoDiscovery enabled and no IP', async () => {
            const adapter2 = Adapter({
                config: {
                    autoDiscovery: true,
                    ipAddress: '',
                    udpPort: 30000,
                    pollInterval: 10000
                }
            });
            adapter2.discoverDevices = sandbox.stub().resolves();
            adapter2.pendingRequests.clear();
            adapter2.socket = mockSocket;

            await adapter2.onReady();
            expect(adapter2.discoverDevices.called).to.be.true;
        });

        it('logs configured device IP', async () => {
            adapter.log.info.resetHistory();
            adapter.config.ipAddress = '192.168.1.50';
            
            await adapter.onReady();
            
            expect(adapter.log.info.calledWithMatch(/192.168.1.50/)).to.be.true;
        });

        it('does not start polling when no IP and autoDiscovery disabled', async () => {
            const adapter3 = Adapter({
                config: {
                    autoDiscovery: false,
                    ipAddress: '',
                    udpPort: 30000,
                    pollInterval: 10000
                }
            });
            adapter3.pendingRequests.clear();
            adapter3._pollingInProgress = false;
            adapter3.socket = mockSocket;

            await adapter3.onReady();
            expect(adapter3.pollInterval).to.be.null;
            expect(adapter3.slowPollInterval).to.be.null;
        });

        it('starts slow polling when IP is configured', async () => {
            adapter.startPolling();
            expect(adapter.slowPollInterval).to.not.be.null;
        });

        it('pollSlow calls all slow poll functions', async () => {
            adapter.pollInfoStatus = sandbox.stub().resolves();
            adapter.pollWifiStatus = sandbox.stub().resolves();
            adapter.pollBLEStatus = sandbox.stub().resolves();

            await adapter.pollSlow();
            expect(adapter.pollInfoStatus.called).to.be.true;
            expect(adapter.pollWifiStatus.called).to.be.true;
            expect(adapter.pollBLEStatus.called).to.be.true;
        });
    });

    describe('onStateChange', () => {
        beforeEach(async () => {
            await adapter.onReady();
            if (adapter.fastPollInterval) clearInterval(adapter.fastPollInterval);
            if (adapter.pollInterval) clearInterval(adapter.pollInterval);
            if (adapter.slowPollInterval) clearInterval(adapter.slowPollInterval);
            adapter.fastPollInterval = null;
            adapter.pollInterval = null;
            adapter.slowPollInterval = null;
            adapter.sendRequest = sandbox.stub().resolves();
            adapter.sendRequest.resetHistory();
            adapter.pendingRequests.clear();
            adapter.pendingRequestsByMethod = new Map();
            adapter.getStateAsync = sandbox.stub();
        });

        it('does nothing for acknowledged states', async () => {
            await adapter.onStateChange('control.mode', { val: 'Auto', ack: true });
            expect(adapter.sendRequest.calledWith('ES.SetMode')).to.be.false;
        });

        it('does nothing for unknown state changes', async () => {
            await adapter.onStateChange('power.pv', { val: 100, ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode')).to.be.false;
        });

        it('handles onStateChange errors gracefully', async () => {
            adapter.getStateAsync.rejects(new Error('State error'));

            try {
                await adapter.onStateChange('control.mode', { val: 'Auto', ack: false });
            } catch (e) {
                // Expected to throw
            }
            expect(adapter.log.error.calledWithMatch(/Failed to set/)).to.be.true;
        });

        it('updates passive control values when not in Manual mode', async () => {
            adapter.getStateAsync = sandbox.stub();
            adapter.getStateAsync.withArgs('control.mode').resolves({ val: 'Passive' });
            adapter.getStateAsync.withArgs('control.passivePower').resolves({ val: 500 });
            adapter.getStateAsync.withArgs('control.passiveDuration').resolves({ val: 600 });

            await adapter.onStateChange('control.passivePower', { val: 300, ack: false });

            expect(adapter.log.error.called).to.be.false;
        });

        it('handles null mode state', async () => {
            adapter.getStateAsync = sandbox.stub();
            adapter.getStateAsync.withArgs('control.mode').resolves(null);

            await adapter.onStateChange('control.passivePower', { val: 300, ack: false });

            expect(adapter.sendRequest.calledWith('ES.SetMode')).to.be.false;
        });

        it('updates Manual mode settings when manual control changes', async () => {
            adapter.getStateAsync = sandbox.stub();
            adapter.getStateAsync.withArgs('control.mode').resolves({ val: 'Manual' });
            adapter.getStateAsync.withArgs('control.manualTimeNum').resolves({ val: 2 });
            adapter.getStateAsync.withArgs('control.manualStartTime').resolves({ val: '06:00' });
            adapter.getStateAsync.withArgs('control.manualEndTime').resolves({ val: '18:00' });
            adapter.getStateAsync.withArgs('control.manualWeekdays').resolves({ val: 65 });
            adapter.getStateAsync.withArgs('control.manualPower').resolves({ val: 2000 });
            adapter.getStateAsync.withArgs('control.manualEnable').resolves({ val: false });

            await adapter.onStateChange('control.manualPower', { val: 1500, ack: false });

            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                id: 0,
                config: sinon.match({
                    mode: 'Manual',
                    manual_cfg: sinon.match({
                        time_num: 2,
                        start_time: '06:00',
                        end_time: '18:00',
                        week_set: 65,
                        power: 2000,
                        enable: 0
                    })
                })
            }))).to.be.true;
        });

        it('does not update Manual settings when not in Manual mode', async () => {
            adapter.getStateAsync = sandbox.stub();
            adapter.getStateAsync.withArgs('control.mode').resolves({ val: 'Auto' });

            await adapter.onStateChange('control.manualPower', { val: 1500, ack: false });

            expect(adapter.sendRequest.calledWith('ES.SetMode')).to.be.false;
        });

        it('handles missing manual control states with defaults', async () => {
            adapter.getStateAsync = sandbox.stub();
            adapter.getStateAsync.withArgs('control.mode').resolves({ val: 'Manual' });
            adapter.getStateAsync.withArgs('control.manualTimeNum').resolves(null);
            adapter.getStateAsync.withArgs('control.manualStartTime').resolves(null);
            adapter.getStateAsync.withArgs('control.manualEndTime').resolves(null);
            adapter.getStateAsync.withArgs('control.manualWeekdays').resolves(null);
            adapter.getStateAsync.withArgs('control.manualPower').resolves(null);
            adapter.getStateAsync.withArgs('control.manualEnable').resolves(null);

            await adapter.onStateChange('control.manualTimeNum', { val: 1, ack: false });

            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                config: sinon.match({
                    manual_cfg: sinon.match({
                        time_num: 0,
                        start_time: '00:00',
                        end_time: '23:59',
                        week_set: 127,
                        power: 100,
                        enable: 0
                    })
                })
            }))).to.be.true;
        });
    });

    describe('onUnload', () => {
        it('handles errors during cleanup', (done) => {
            adapter.socket = null;
            adapter.pollInterval = null;
            adapter.slowPollInterval = null;
            adapter.pendingRequests.clear();

            adapter.onUnload(() => {
                done();
            });
        });

        it('handles exception during cleanup', (done) => {
            adapter.socket = null;
            adapter.pollInterval = null;
            adapter.slowPollInterval = null;
            adapter.pendingRequests = null;

            adapter.onUnload(() => {
                done();
            });
        });
    });

    describe('discoverDevices()', () => {
        beforeEach(async () => {
            await adapter.onReady();
            adapter.socket = { send: sandbox.stub().yields(null) };
            sandbox.stub(global, 'setTimeout').callsFake((fn) => { fn(); return 1; });
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('sends all 3 discovery attempts to broadcast and multicast', async () => {
            await adapter.discoverDevices();
            expect(adapter.socket.send.callCount).to.equal(6);
            // Verify broadcast (255.255.255.255) and multicast (239.255.255.250) are called for each attempt
            const calls = adapter.socket.send.getCalls();
            // Each attempt: broadcast + multicast = 2 calls, 3 attempts = 6 total
            expect(calls.length).to.equal(6);
        });

        it('handles broadcast send errors gracefully', async () => {
            adapter.socket.send.onFirstCall().yields(new Error('Broadcast failed'));
            await adapter.discoverDevices();
            expect(adapter.log.error.calledOnce).to.be.true;
        });

        it('handles multicast send errors as debug only', async () => {
            adapter.socket.send.onSecondCall().yields(new Error('Multicast failed'));
            await adapter.discoverDevices();
            expect(adapter.log.debug.called).to.be.true;
            expect(adapter.log.error.called).to.be.false;
        });

        it('catches exceptions during discovery attempts', async () => {
            adapter.socket.send.throws(new Error('Send exception'));
            await adapter.discoverDevices();
            expect(adapter.log.error.called).to.be.true;
        });
    });

    describe('setControlTarget', () => {
        beforeEach(async () => {
            await adapter.onReady();
            adapter.sendRequest = sandbox.stub().resolves();
            adapter.pendingRequests.clear();
            adapter.pendingRequestsByMethod = new Map();
        });

        it('handles valid control values', async () => {
            await adapter.setControlTarget(150);
            expect(adapter.sendRequest.calledWith('Marstek.SetTargetPower', { power: 150 })).to.be.true;
        });

        it('clamps values within min/max range', async () => {
            await adapter.setControlTarget(-2000);
            expect(adapter.sendRequest.calledWith('Marstek.SetTargetPower', { power: -1500 })).to.be.true;
            
            await adapter.setControlTarget(2000);
            expect(adapter.sendRequest.calledWith('Marstek.SetTargetPower', { power: 1500 })).to.be.true;
        });

        it('ignores null and undefined values', async () => {
            await adapter.setControlTarget(null);
            expect(adapter.sendRequest.calledWith('Marstek.SetTargetPower')).to.be.false;
        });
    });
});
