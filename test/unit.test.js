const chai = require('chai');
const sinon = require('sinon');
const expect = chai.expect;

class MockAdapter {
    constructor(options = {}) {
        this.name = options.name || 'adapter';
        this.socket = null;
        this.requestId = 1;
        this.pendingRequests = new Map();
        this.pollInterval = null;
        this.discoveredIP = null;
        this.config = {
            autoDiscovery: false,
            ipAddress: '192.168.1.100',
            udpPort: 30000,
            pollInterval: 1000
        };
        this.setStateChangedAsyncSpy = sinon.stub().resolves({});
        this.setObjectNotExistsAsyncSpy = sinon.stub().resolves({});
        this.setStateAsync = sinon.stub().resolves({});
        this.getStateAsync = sinon.stub().resolves(null);
        this.subscribeStatesAsync = sinon.stub().resolves();
        this.log = { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    }

    async initStates() {
        const creates = [
            'info.device', 'info.firmware', 'info.mac', 'info.connection',
            'battery.soc', 'battery.temperature', 'battery.capacity', 'battery.ratedCapacity',
            'battery.chargingAllowed', 'battery.dischargingAllowed',
            'power.pv', 'power.pvVoltage', 'power.pvCurrent', 'power.grid', 'power.battery', 'power.load',
            'energy.pvTotal', 'energy.gridImport', 'energy.gridExport', 'energy.loadTotal',
            'control.mode', 'control.passivePower', 'control.passiveDuration',
            'control.manualTimeNum', 'control.manualStartTime', 'control.manualEndTime',
            'control.manualWeekdays', 'control.manualPower', 'control.manualEnable',
            'network', 'network.ip', 'network.ssid', 'network.rssi', 'network.bleState',
            'energymeter', 'energymeter.ctState', 'energymeter.powerA', 'energymeter.powerB',
            'energymeter.powerC', 'energymeter.powerTotal'
        ];
        for (const id of creates) {
            await this.setObjectNotExistsAsyncSpy(id, {});
        }
        await this.subscribeStatesAsync('control.*');
    }

    async sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.requestId++;
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${method} timed out`));
            }, 5000);
            this.pendingRequests.set(id, { resolve, reject, timeout });
        });
    }

    handleResponse(response) {
        if (response.id !== undefined && this.pendingRequests.has(response.id)) {
            const pending = this.pendingRequests.get(response.id);
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id);
            if (response.error) {
                pending.reject(new Error(`API Error ${response.error.code}: ${response.error.message}`));
            } else {
                pending.resolve(response.result);
            }
        } else if (response.result && response.result.device) {
            if (!this.config.ipAddress && response.result.ip) {
                this.discoveredIP = response.result.ip;
            }
        }
    }

    async pollESStatus() {
        const result = await this.sendRequest('ES.GetStatus', { id: 0 });
        await this.setStateChangedAsyncSpy('power.pv', { val: result.pv_power, ack: true });
        await this.setStateChangedAsyncSpy('power.grid', { val: result.ongrid_power, ack: true });
        await this.setStateChangedAsyncSpy('power.battery', { val: result.bat_power, ack: true });
        await this.setStateChangedAsyncSpy('power.load', { val: result.offgrid_power, ack: true });
        await this.setStateChangedAsyncSpy('energy.pvTotal', { val: result.total_pv_energy, ack: true });
        await this.setStateChangedAsyncSpy('energy.gridExport', { val: result.total_grid_output_energy, ack: true });
        await this.setStateChangedAsyncSpy('energy.gridImport', { val: result.total_grid_input_energy, ack: true });
        await this.setStateChangedAsyncSpy('energy.loadTotal', { val: result.total_load_energy, ack: true });
        await this.setStateChangedAsyncSpy('battery.soc', { val: result.bat_soc, ack: true });
    }

    async pollBatteryStatus() {
        const result = await this.sendRequest('Bat.GetStatus', { id: 0 });
        await this.setStateChangedAsyncSpy('battery.soc', { val: result.soc, ack: true });
        await this.setStateChangedAsyncSpy('battery.temperature', { val: result.bat_temp, ack: true });
        await this.setStateChangedAsyncSpy('battery.capacity', { val: result.bat_capacity, ack: true });
        await this.setStateChangedAsyncSpy('battery.ratedCapacity', { val: result.rated_capacity, ack: true });
        await this.setStateChangedAsyncSpy('battery.chargingAllowed', { val: result.charg_flag, ack: true });
        await this.setStateChangedAsyncSpy('battery.dischargingAllowed', { val: result.dischrg_flag, ack: true });
    }

    async pollPVStatus() {
        try {
            const result = await this.sendRequest('PV.GetStatus', { id: 0 });
            await this.setStateChangedAsyncSpy('power.pv', { val: result.pv_power, ack: true });
            await this.setStateChangedAsyncSpy('power.pvVoltage', { val: result.pv_voltage, ack: true });
            await this.setStateChangedAsyncSpy('power.pvCurrent', { val: result.pv_current, ack: true });
        } catch (e) {
            this.log.debug(`Poll PV status failed: ${e.message}`);
        }
    }

    async pollWifiStatus() {
        try {
            const result = await this.sendRequest('Wifi.GetStatus', { id: 0 });
            await this.setStateChangedAsyncSpy('network.ip', { val: result.sta_ip, ack: true });
            await this.setStateChangedAsyncSpy('network.ssid', { val: result.ssid, ack: true });
            await this.setStateChangedAsyncSpy('network.rssi', { val: result.rssi, ack: true });
        } catch (e) {
            this.log.debug(`Poll WiFi status failed: ${e.message}`);
        }
    }

    async pollBLEStatus() {
        try {
            const result = await this.sendRequest('BLE.GetStatus', { id: 0 });
            await this.setStateChangedAsyncSpy('network.bleState', { val: result.state, ack: true });
        } catch (e) {
            this.log.debug(`Poll BLE status failed: ${e.message}`);
        }
    }

    async pollEMStatus() {
        try {
            const result = await this.sendRequest('EM.GetStatus', { id: 0 });
            await this.setStateChangedAsyncSpy('energymeter.ctState', { val: result.ct_state, ack: true });
            await this.setStateChangedAsyncSpy('energymeter.powerA', { val: result.a_power, ack: true });
            await this.setStateChangedAsyncSpy('energymeter.powerB', { val: result.b_power, ack: true });
            await this.setStateChangedAsyncSpy('energymeter.powerC', { val: result.c_power, ack: true });
            await this.setStateChangedAsyncSpy('energymeter.powerTotal', { val: result.total_power, ack: true });
        } catch (e) {
            this.log.debug(`Poll EM status failed: ${e.message}`);
        }
    }

    async pollModeStatus() {
        const result = await this.sendRequest('ES.GetMode', { id: 0 });
        await this.setStateChangedAsyncSpy('control.mode', { val: result.mode, ack: true });
    }

    async poll() {
        try {
            await this.pollESStatus();
            await this.pollBatteryStatus();
            await this.pollPVStatus();
            await this.pollWifiStatus();
            await this.pollBLEStatus();
            await this.pollEMStatus();
            await this.pollModeStatus();
            await this.setStateAsync('info.connection', { val: true, ack: true });
        } catch (err) {
            await this.setStateAsync('info.connection', { val: false, ack: true });
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) return;
        const stateName = id.split('.').pop();
        try {
            if (stateName === 'mode') {
                const mode = state.val;
                let config = { mode };
                if (mode === 'Auto') {
                    config.auto_cfg = { enable: 1 };
                } else if (mode === 'AI') {
                    config.ai_cfg = { enable: 1 };
                } else if (mode === 'Passive') {
                    const power = await this.getStateAsync('control.passivePower');
                    const duration = await this.getStateAsync('control.passiveDuration');
                    config.passive_cfg = {
                        power: power?.val || 0,
                        cd_time: duration?.val || 300
                    };
                } else if (mode === 'Manual') {
                    const timeNum = await this.getStateAsync('control.manualTimeNum');
                    const startTime = await this.getStateAsync('control.manualStartTime');
                    const endTime = await this.getStateAsync('control.manualEndTime');
                    const weekdays = await this.getStateAsync('control.manualWeekdays');
                    const power = await this.getStateAsync('control.manualPower');
                    const enable = await this.getStateAsync('control.manualEnable');
                    config.manual_cfg = {
                        time_num: timeNum?.val || 0,
                        start_time: startTime?.val || '00:00',
                        end_time: endTime?.val || '23:59',
                        week_set: weekdays?.val || 127,
                        power: power?.val || 100,
                        enable: enable?.val ? 1 : 0
                    };
                }
                await this.sendRequest('ES.SetMode', { id: 0, config });
                await this.setStateAsync(id, { val: mode, ack: true });
            }
        } catch (err) {
            this.log.error(`Failed to set ${stateName}: ${err.message}`);
        }
    }

    startPolling() {
        this.pollInterval = setInterval(() => this.poll(), this.config.pollInterval || 1000);
    }
}

describe('MarstekVenusAdapter', () => {
    let adapter;

    beforeEach(() => {
        adapter = new MockAdapter();
    });

    describe('constructor', () => {
        it('should initialize with requestId starting at 1', () => {
            expect(adapter.requestId).to.equal(1);
        });

        it('should initialize with empty pendingRequests Map', () => {
            expect(adapter.pendingRequests).to.be.instanceOf(Map);
            expect(adapter.pendingRequests.size).to.equal(0);
        });

        it('should initialize with null pollInterval', () => {
            expect(adapter.pollInterval).to.be.null;
        });

        it('should initialize with null discoveredIP', () => {
            expect(adapter.discoveredIP).to.be.null;
        });
    });

    describe('initStates', () => {
        beforeEach(async () => {
            await adapter.initStates();
        });

        it('should create all required states', () => {
            const calls = adapter.setObjectNotExistsAsyncSpy.getCalls();
            const createdIds = calls.map(c => c.args[0]);

            expect(createdIds).to.include('info.device');
            expect(createdIds).to.include('info.firmware');
            expect(createdIds).to.include('info.mac');
            expect(createdIds).to.include('info.connection');
            expect(createdIds).to.include('battery.soc');
            expect(createdIds).to.include('battery.temperature');
            expect(createdIds).to.include('battery.capacity');
            expect(createdIds).to.include('battery.ratedCapacity');
            expect(createdIds).to.include('battery.chargingAllowed');
            expect(createdIds).to.include('battery.dischargingAllowed');
            expect(createdIds).to.include('power.pv');
            expect(createdIds).to.include('power.pvVoltage');
            expect(createdIds).to.include('power.pvCurrent');
            expect(createdIds).to.include('power.grid');
            expect(createdIds).to.include('power.battery');
            expect(createdIds).to.include('power.load');
            expect(createdIds).to.include('energy.pvTotal');
            expect(createdIds).to.include('energy.gridImport');
            expect(createdIds).to.include('energy.gridExport');
            expect(createdIds).to.include('energy.loadTotal');
            expect(createdIds).to.include('control.mode');
            expect(createdIds).to.include('control.passivePower');
            expect(createdIds).to.include('control.passiveDuration');
            expect(createdIds).to.include('control.manualTimeNum');
            expect(createdIds).to.include('control.manualStartTime');
            expect(createdIds).to.include('control.manualEndTime');
            expect(createdIds).to.include('control.manualWeekdays');
            expect(createdIds).to.include('control.manualPower');
            expect(createdIds).to.include('control.manualEnable');
            expect(createdIds).to.include('network');
            expect(createdIds).to.include('network.ip');
            expect(createdIds).to.include('network.ssid');
            expect(createdIds).to.include('network.rssi');
            expect(createdIds).to.include('network.bleState');
            expect(createdIds).to.include('energymeter');
            expect(createdIds).to.include('energymeter.ctState');
            expect(createdIds).to.include('energymeter.powerA');
            expect(createdIds).to.include('energymeter.powerB');
            expect(createdIds).to.include('energymeter.powerC');
            expect(createdIds).to.include('energymeter.powerTotal');
        });

        it('should subscribe to control states', () => {
            expect(adapter.subscribeStatesAsync.calledWith('control.*')).to.be.true;
        });
    });

    describe('sendRequest', () => {
        it('should increment requestId for each request', async () => {
            const originalId = adapter.requestId;
            
            adapter.sendRequest('ES.GetStatus', {});
            const idAfterFirst = adapter.requestId;
            adapter.sendRequest('Bat.GetStatus', {});
            const idAfterSecond = adapter.requestId;

            expect(idAfterFirst).to.be.greaterThan(originalId);
            expect(idAfterSecond).to.be.greaterThan(idAfterFirst);
        });

        it('should add pending request to map', async () => {
            const promise = adapter.sendRequest('ES.GetStatus', {});
            expect(adapter.pendingRequests.size).to.be.equal(1);
            await promise.catch(() => {});
        });

        it('should reject on timeout', async () => {
            const clock = sinon.useFakeTimers();

            const promise = adapter.sendRequest('ES.GetStatus', {});
            clock.tick(5001);
            
            try {
                await promise;
                expect.fail('Should have rejected');
            } catch (e) {
                expect(e.message).to.include('timed out');
            }

            clock.restore();
        });
    });

    describe('handleResponse', () => {
        it('should resolve pending request on success', async () => {
            const promise = adapter.sendRequest('ES.GetStatus', {});
            const requestId = adapter.requestId - 1;

            adapter.handleResponse({
                id: requestId,
                result: { bat_soc: 98 }
            });

            const result = await promise;
            expect(result).to.deep.equal({ bat_soc: 98 });
        });

        it('should reject pending request on error', async () => {
            const promise = adapter.sendRequest('ES.GetStatus', {});
            const requestId = adapter.requestId - 1;

            adapter.handleResponse({
                id: requestId,
                error: { code: -32600, message: 'Invalid Request' }
            });

            try {
                await promise;
                expect.fail('Should have rejected');
            } catch (e) {
                expect(e.message).to.include('Invalid Request');
            }
        });

        it('should set discoveredIP on discovery response when no ip configured', () => {
            adapter.config.ipAddress = '';
            adapter.handleResponse({
                result: {
                    device: 'VenusC',
                    ver: 111,
                    ip: '192.168.1.100',
                    ble_mac: '123456789012'
                }
            });

            expect(adapter.discoveredIP).to.equal('192.168.1.100');
        });

        it('should not overwrite configured ipAddress on discovery', () => {
            adapter.config.ipAddress = '192.168.1.50';
            adapter.handleResponse({
                result: {
                    device: 'VenusC',
                    ip: '192.168.1.100'
                }
            });

            expect(adapter.discoveredIP).to.be.null;
        });
    });

    describe('pollESStatus', () => {
        it('should set ES status states with correct values', async () => {
            adapter.sendRequest = async () => ({
                pv_power: 580,
                ongrid_power: 100,
                bat_power: 0,
                offgrid_power: 0,
                total_pv_energy: 1000,
                total_grid_output_energy: 500,
                total_grid_input_energy: 200,
                total_load_energy: 300,
                bat_soc: 98
            });

            await adapter.pollESStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'power.pv').val).to.equal(580);
            expect(updates.find(u => u.id === 'power.grid').val).to.equal(100);
            expect(updates.find(u => u.id === 'power.battery').val).to.equal(0);
            expect(updates.find(u => u.id === 'power.load').val).to.equal(0);
            expect(updates.find(u => u.id === 'energy.pvTotal').val).to.equal(1000);
            expect(updates.find(u => u.id === 'energy.gridExport').val).to.equal(500);
            expect(updates.find(u => u.id === 'energy.gridImport').val).to.equal(200);
            expect(updates.find(u => u.id === 'energy.loadTotal').val).to.equal(300);
            expect(updates.find(u => u.id === 'battery.soc').val).to.equal(98);
        });
    });

    describe('pollBatteryStatus', () => {
        it('should set battery status states with correct values', async () => {
            adapter.sendRequest = async () => ({
                soc: 98,
                bat_temp: 25.0,
                bat_capacity: 2508.0,
                rated_capacity: 2560.0,
                charg_flag: true,
                dischrg_flag: true
            });

            await adapter.pollBatteryStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'battery.soc').val).to.equal(98);
            expect(updates.find(u => u.id === 'battery.temperature').val).to.equal(25.0);
            expect(updates.find(u => u.id === 'battery.capacity').val).to.equal(2508.0);
            expect(updates.find(u => u.id === 'battery.ratedCapacity').val).to.equal(2560.0);
            expect(updates.find(u => u.id === 'battery.chargingAllowed').val).to.equal(true);
            expect(updates.find(u => u.id === 'battery.dischargingAllowed').val).to.equal(true);
        });
    });

    describe('pollPVStatus', () => {
        it('should set PV status states with correct values', async () => {
            adapter.sendRequest = async () => ({
                pv_power: 580.0,
                pv_voltage: 40.0,
                pv_current: 12.0
            });

            await adapter.pollPVStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'power.pv').val).to.equal(580.0);
            expect(updates.find(u => u.id === 'power.pvVoltage').val).to.equal(40.0);
            expect(updates.find(u => u.id === 'power.pvCurrent').val).to.equal(12.0);
        });

        it('should handle PV status errors gracefully', async () => {
            adapter.sendRequest = async () => { throw new Error('PV not connected'); };

            await adapter.pollPVStatus();
        });
    });

    describe('pollWifiStatus', () => {
        it('should set WiFi status states with correct values', async () => {
            adapter.sendRequest = async () => ({
                sta_ip: '192.168.1.100',
                ssid: 'MyHome',
                rssi: -59
            });

            await adapter.pollWifiStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'network.ip').val).to.equal('192.168.1.100');
            expect(updates.find(u => u.id === 'network.ssid').val).to.equal('MyHome');
            expect(updates.find(u => u.id === 'network.rssi').val).to.equal(-59);
        });

        it('should handle WiFi status errors gracefully', async () => {
            adapter.sendRequest = async () => { throw new Error('WiFi error'); };

            await adapter.pollWifiStatus();
        });
    });

    describe('pollBLEStatus', () => {
        it('should set BLE status state with correct value', async () => {
            adapter.sendRequest = async () => ({
                state: 'connect',
                ble_mac: '123456789012'
            });

            await adapter.pollBLEStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'network.bleState').val).to.equal('connect');
        });

        it('should handle BLE status errors gracefully', async () => {
            adapter.sendRequest = async () => { throw new Error('BLE error'); };

            await adapter.pollBLEStatus();
        });
    });

    describe('pollEMStatus', () => {
        it('should set EM status states with correct values', async () => {
            adapter.sendRequest = async () => ({
                ct_state: 1,
                a_power: 100,
                b_power: 200,
                c_power: 300,
                total_power: 600
            });

            await adapter.pollEMStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'energymeter.ctState').val).to.equal(1);
            expect(updates.find(u => u.id === 'energymeter.powerA').val).to.equal(100);
            expect(updates.find(u => u.id === 'energymeter.powerB').val).to.equal(200);
            expect(updates.find(u => u.id === 'energymeter.powerC').val).to.equal(300);
            expect(updates.find(u => u.id === 'energymeter.powerTotal').val).to.equal(600);
        });

        it('should handle EM status errors gracefully', async () => {
            adapter.sendRequest = async () => { throw new Error('EM error'); };

            await adapter.pollEMStatus();
        });
    });

    describe('pollModeStatus', () => {
        it('should set mode status state with correct value', async () => {
            adapter.sendRequest = async () => ({ mode: 'Passive' });

            await adapter.pollModeStatus();

            const calls = adapter.setStateChangedAsyncSpy.getCalls();
            const updates = calls.map(c => ({ id: c.args[0], val: c.args[1].val }));

            expect(updates.find(u => u.id === 'control.mode').val).to.equal('Passive');
        });
    });

    describe('onStateChange', () => {
        it('should not process acknowledged states', async () => {
            adapter.sendRequest = async () => ({});
            await adapter.onStateChange('control.mode', { val: 'Auto', ack: true });
            expect(adapter.sendRequest.callCount).to.be.equal(0);
        });

        it('should send ES.SetMode for mode change to Auto', async () => {
            adapter.sendRequest = async () => ({});
            await adapter.onStateChange('control.mode', { val: 'Auto', ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                id: 0,
                config: {
                    mode: 'Auto',
                    auto_cfg: { enable: 1 }
                }
            }))).to.be.true;
        });

        it('should send ES.SetMode for mode change to AI', async () => {
            adapter.sendRequest = async () => ({});
            await adapter.onStateChange('control.mode', { val: 'AI', ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                id: 0,
                config: {
                    mode: 'AI',
                    ai_cfg: { enable: 1 }
                }
            }))).to.be.true;
        });

        it('should send ES.SetMode with passive config', async () => {
            adapter.sendRequest = async () => ({});
            adapter.getStateAsync = async (id) => {
                if (id === 'control.passivePower') return { val: 100 };
                if (id === 'control.passiveDuration') return { val: 300 };
                return null;
            };
            await adapter.onStateChange('control.mode', { val: 'Passive', ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                id: 0,
                config: {
                    mode: 'Passive',
                    passive_cfg: {
                        power: 100,
                        cd_time: 300
                    }
                }
            }))).to.be.true;
        });

        it('should send ES.SetMode with manual config', async () => {
            adapter.sendRequest = async () => ({});
            adapter.getStateAsync = async (id) => {
                const states = {
                    'control.manualTimeNum': { val: 1 },
                    'control.manualStartTime': { val: '08:30' },
                    'control.manualEndTime': { val: '20:30' },
                    'control.manualWeekdays': { val: 127 },
                    'control.manualPower': { val: 500 },
                    'control.manualEnable': { val: true }
                };
                return states[id] || null;
            };
            await adapter.onStateChange('control.mode', { val: 'Manual', ack: false });
            expect(adapter.sendRequest.calledWith('ES.SetMode', sinon.match({
                id: 0,
                config: {
                    mode: 'Manual',
                    manual_cfg: {
                        time_num: 1,
                        start_time: '08:30',
                        end_time: '20:30',
                        week_set: 127,
                        power: 500,
                        enable: 1
                    }
                }
            }))).to.be.true;
        });
    });

    describe('poll', () => {
        it('should set connection to true on success', async () => {
            adapter.pollESStatus = async () => {};
            adapter.pollBatteryStatus = async () => {};
            adapter.pollPVStatus = async () => {};
            adapter.pollWifiStatus = async () => {};
            adapter.pollBLEStatus = async () => {};
            adapter.pollEMStatus = async () => {};
            adapter.pollModeStatus = async () => {};

            await adapter.poll();

            expect(adapter.setStateAsync.calledWith('info.connection', { val: true, ack: true })).to.be.true;
        });

        it('should set connection to false on error', async () => {
            adapter.pollESStatus = async () => { throw new Error('Connection error'); };
            adapter.pollBatteryStatus = async () => {};
            adapter.pollPVStatus = async () => {};
            adapter.pollWifiStatus = async () => {};
            adapter.pollBLEStatus = async () => {};
            adapter.pollEMStatus = async () => {};
            adapter.pollModeStatus = async () => {};

            await adapter.poll();

            expect(adapter.setStateAsync.calledWith('info.connection', { val: false, ack: true })).to.be.true;
        });
    });

    describe('startPolling', () => {
        it('should set pollInterval', () => {
            const clock = sinon.useFakeTimers();
            
            adapter.startPolling();

            expect(adapter.pollInterval).to.not.be.null;

            clock.restore();
        });
    });
});
