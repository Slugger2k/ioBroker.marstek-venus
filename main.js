'use strict';

const utils = require('@iobroker/adapter-core');
const dgram = require('node:dgram');

class MarstekVenusAdapter extends utils.Adapter {

    constructor(options = {}) {
        super({
            ...options,
            name: 'marstek-venus',
        });

        this.socket = null;
        this.requestId = 1;
        this.pendingRequests = new Map();
        this.pollInterval = null;
        this.deviceInfo = null;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('message', this.onMessage.bind(this));
    }

    async onReady() {
        this.log.info('Starting Marstek Venus adapter');
        
        await this.initStates();

        this.socket = dgram.createSocket('udp4');
        
        this.socket.on('error', (err) => {
            this.log.error(`UDP socket error: ${err.message}`);
        });

        this.socket.on('message', this.handleResponse.bind(this));
        
        this.socket.bind(() => {
            this.socket.setBroadcast(true);
            this.log.debug('UDP socket bound successfully');
        });

        if (this.config.autoDiscovery && !this.config.ipAddress) {
            await this.discoverDevices();
        } else if (this.config.ipAddress) {
            this.log.info(`Using configured device: ${this.config.ipAddress}:${this.config.udpPort}`);
            this.startPolling();
        } else {
            this.log.warn('No device configured and auto-discovery disabled');
        }
    }

    async initStates() {
        await this.setObjectNotExistsAsync('info.device', {
            type: 'state', common: { name: 'Device model', type: 'string', role: 'text', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('info.firmware', {
            type: 'state', common: { name: 'Firmware version', type: 'number', role: 'value', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('info.mac', {
            type: 'state', common: { name: 'Device MAC', type: 'string', role: 'text', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state', common: { name: 'Connected', type: 'boolean', role: 'indicator.connected', read: true, write: false }, native: {}
        });

        await this.setObjectNotExistsAsync('battery.soc', {
            type: 'state', common: { name: 'State of charge', type: 'number', unit: '%', role: 'value.battery', min: 0, max: 100, read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('battery.temperature', {
            type: 'state', common: { name: 'Battery temperature', type: 'number', unit: '°C', role: 'value.temperature', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('battery.capacity', {
            type: 'state', common: { name: 'Remaining capacity', type: 'number', unit: 'Wh', role: 'value.energy', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('battery.ratedCapacity', {
            type: 'state', common: { name: 'Rated capacity', type: 'number', unit: 'Wh', role: 'value.energy', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('battery.chargingAllowed', {
            type: 'state', common: { name: 'Charging allowed', type: 'boolean', role: 'indicator', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('battery.dischargingAllowed', {
            type: 'state', common: { name: 'Discharging allowed', type: 'boolean', role: 'indicator', read: true, write: false }, native: {}
        });

        await this.setObjectNotExistsAsync('power.pv', {
            type: 'state', common: { name: 'PV power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('power.grid', {
            type: 'state', common: { name: 'Grid power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('power.battery', {
            type: 'state', common: { name: 'Battery power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('power.load', {
            type: 'state', common: { name: 'Load power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });

        await this.setObjectNotExistsAsync('energy.pvTotal', {
            type: 'state', common: { name: 'Total PV energy', type: 'number', unit: 'Wh', role: 'value.energy.consumption', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energy.gridImport', {
            type: 'state', common: { name: 'Total grid import', type: 'number', unit: 'Wh', role: 'value.energy.consumption', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energy.gridExport', {
            type: 'state', common: { name: 'Total grid export', type: 'number', unit: 'Wh', role: 'value.energy.consumption', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energy.loadTotal', {
            type: 'state', common: { name: 'Total load energy', type: 'number', unit: 'Wh', role: 'value.energy.consumption', read: true, write: false }, native: {}
        });

        await this.setObjectNotExistsAsync('control.mode', {
            type: 'state', common: { name: 'Operating mode', type: 'string', role: 'text', read: true, write: true, states: { 'Auto': 'Auto', 'AI': 'AI', 'Manual': 'Manual', 'Passive': 'Passive' } }, native: {}
        });
        await this.setObjectNotExistsAsync('control.passivePower', {
            type: 'state', common: { name: 'Passive mode power', type: 'number', unit: 'W', role: 'level.power', min: 0, max: 3000, read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.passiveDuration', {
            type: 'state', common: { name: 'Passive mode duration', type: 'number', unit: 's', role: 'level', min: 0, max: 86400, read: true, write: true }, native: {}
        });

        await this.setObjectNotExistsAsync('network.ip', {
            type: 'state', common: { name: 'IP Address', type: 'string', role: 'text', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('network.ssid', {
            type: 'state', common: { name: 'WiFi SSID', type: 'string', role: 'text', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('network.rssi', {
            type: 'state', common: { name: 'WiFi signal', type: 'number', unit: 'dBm', role: 'value.rssi', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('network.bleState', {
            type: 'state', common: { name: 'Bluetooth state', type: 'string', role: 'text', read: true, write: false }, native: {}
        });

        await this.subscribeStatesAsync('control.*');
        await this.setStateAsync('info.connection', { val: false, ack: true });
    }

    async discoverDevices() {
        this.log.info('Starting device discovery on local network');
        
        const request = {
            id: this.requestId++,
            method: 'Marstek.GetDevice',
            params: { ble_mac: '0' }
        };

        const message = Buffer.from(JSON.stringify(request));
        
        this.socket.send(message, 0, message.length, this.config.udpPort, '255.255.255.255', (err) => {
            if (err) {
                this.log.error(`Discovery broadcast failed: ${err.message}`);
            }
        });
    }

    async sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.requestId++;
            
            const request = { id, method, params };
            const message = Buffer.from(JSON.stringify(request));

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${method} timed out`));
            }, 5000);

            this.pendingRequests.set(id, { resolve, reject, timeout, method });

            this.socket.send(message, 0, message.length, this.config.udpPort, this.config.ipAddress, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
        });
    }

    handleResponse(msgBuffer, rinfo) {
        try {
            const response = JSON.parse(msgBuffer.toString());
            
            if (response.id !== undefined && this.pendingRequests.has(response.id)) {
                const pending = this.pendingRequests.get(response.id);
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(response.id);

                if (response.error) {
                    pending.reject(new Error(`API Error ${response.error.code}: ${response.error.message}`));
                } else {
                    pending.resolve(response.result);
                }
            } else if (response.method === 'Marstek.GetDevice') {
                this.log.info(`Discovered device: ${response.result.device} at ${response.result.ip}`);
                if (!this.config.ipAddress) {
                    this.config.ipAddress = response.result.ip;
                    this.log.info(`Auto-selecting discovered device: ${this.config.ipAddress}`);
                    this.startPolling();
                }
            }
        } catch (e) {
            this.log.debug(`Invalid response received: ${e.message}`);
        }
    }

    startPolling() {
        this.log.info('Starting polling loop');
        this.pollInterval = setInterval(() => this.poll(), this.config.pollInterval || 1000);
        this.poll();
    }

    async poll() {
        try {
            await Promise.all([
                this.pollESStatus(),
                this.pollBatteryStatus(),
                this.pollPVStatus(),
                this.pollWifiStatus(),
                this.pollBLEStatus(),
                this.pollEMStatus(),
                this.pollModeStatus()
            ]);
            
            await this.setStateAsync('info.connection', { val: true, ack: true });
        } catch (err) {
            this.log.debug(`Poll failed: ${err.message}`);
            await this.setStateAsync('info.connection', { val: false, ack: true });
        }
    }

    async pollESStatus() {
        const result = await this.sendRequest('ES.GetStatus', { id: 0 });
        
        await this.setStateChangedAsync('battery.soc', { val: result.bat_soc, ack: true });
        await this.setStateChangedAsync('battery.capacity', { val: result.bat_cap, ack: true });
        await this.setStateChangedAsync('power.pv', { val: result.pv_power, ack: true });
        await this.setStateChangedAsync('power.grid', { val: result.ongrid_power, ack: true });
        await this.setStateChangedAsync('power.battery', { val: result.bat_power, ack: true });
        await this.setStateChangedAsync('power.load', { val: result.offgrid_power, ack: true });
        await this.setStateChangedAsync('energy.pvTotal', { val: result.total_pv_energy, ack: true });
        await this.setStateChangedAsync('energy.gridExport', { val: result.total_grid_output_energy, ack: true });
        await this.setStateChangedAsync('energy.gridImport', { val: result.total_grid_input_energy, ack: true });
        await this.setStateChangedAsync('energy.loadTotal', { val: result.total_load_energy, ack: true });
    }

    async pollBatteryStatus() {
        const result = await this.sendRequest('Bat.GetStatus', { id: 0 });
        
        await this.setStateChangedAsync('battery.soc', { val: result.soc, ack: true });
        await this.setStateChangedAsync('battery.temperature', { val: result.bat_temp, ack: true });
        await this.setStateChangedAsync('battery.capacity', { val: result.bat_capacity, ack: true });
        await this.setStateChangedAsync('battery.ratedCapacity', { val: result.rated_capacity, ack: true });
        await this.setStateChangedAsync('battery.chargingAllowed', { val: result.charg_flag, ack: true });
        await this.setStateChangedAsync('battery.dischargingAllowed', { val: result.dischrg_flag, ack: true });
    }

    async pollPVStatus() {
        try {
            const result = await this.sendRequest('PV.GetStatus', { id: 0 });
            await this.setStateChangedAsync('power.pv', { val: result.pv_power, ack: true });
        } catch (e) {
        }
    }

    async pollWifiStatus() {
        const result = await this.sendRequest('Wifi.GetStatus', { id: 0 });
        
        await this.setStateChangedAsync('network.ip', { val: result.sta_ip, ack: true });
        await this.setStateChangedAsync('network.ssid', { val: result.ssid, ack: true });
        await this.setStateChangedAsync('network.rssi', { val: result.rssi, ack: true });
    }

    async pollBLEStatus() {
        const result = await this.sendRequest('BLE.GetStatus', { id: 0 });
        await this.setStateChangedAsync('network.bleState', { val: result.state, ack: true });
    }

    async pollEMStatus() {
        try {
            await this.sendRequest('EM.GetStatus', { id: 0 });
        } catch (e) {
        }
    }

    async pollModeStatus() {
        const result = await this.sendRequest('ES.GetMode', { id: 0 });
        await this.setStateChangedAsync('control.mode', { val: result.mode, ack: true });
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
                }

                await this.sendRequest('ES.SetMode', { id: 0, config });
                this.log.info(`Successfully set operating mode to ${mode}`);
                await this.setStateAsync(id, { val: mode, ack: true });
            }
        } catch (err) {
            this.log.error(`Failed to set ${stateName}: ${err.message}`);
        }
    }

    async onMessage(obj) {
        if (obj.command === 'discover') {
            await this.discoverDevices();
            if (obj.callback) this.sendTo(obj.from, obj.command, { success: true }, obj.callback);
        }
    }

    onUnload(callback) {
        try {
            this.log.info('Shutting down Marstek Venus adapter');
            
            if (this.pollInterval) clearInterval(this.pollInterval);
            if (this.socket) this.socket.close();
            
            this.pendingRequests.forEach((pending) => {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Adapter shutting down'));
            });

            callback();
        } catch (e) {
            callback();
        }
    }
}

if (module.parent) {
    module.exports = (options) => new MarstekVenusAdapter(options);
} else {
    new MarstekVenusAdapter();
}
