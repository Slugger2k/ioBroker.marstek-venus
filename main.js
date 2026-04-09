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
        this.slowPollInterval = null;
        this.discoveredIP = null;
        this._pollingInProgress = false;
        this._pollFailureCount = 0;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('message', this.onMessage.bind(this));
    }

    async onReady() {
        this.log.info('Starting Marstek Venus adapter');
        
        await this.initStates();

        await this.setStateAsync('control.mode', { val: 'Auto', ack: true });
        await this.setStateAsync('control.passivePower', { val: 0, ack: true });
        await this.setStateAsync('control.passiveDuration', { val: 300, ack: true });

        this.socket = dgram.createSocket('udp4');
        
        this.socket.on('error', (err) => {
            this.log.error(`UDP socket error: ${err.message}`);
        });
        
        this.socket.on('message', this.handleResponse.bind(this));
        
        this.socket.bind(0, () => {
            this.socket.setBroadcast(true);
            const address = this.socket.address();
            this.log.debug(`UDP socket bound successfully to ${address.address}:${address.port}`);
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
        await this.setObjectNotExistsAsync('power.pvVoltage', {
            type: 'state', common: { name: 'PV voltage', type: 'number', unit: 'V', role: 'value.voltage', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('power.pvCurrent', {
            type: 'state', common: { name: 'PV current', type: 'number', unit: 'A', role: 'value.current', read: true, write: false }, native: {}
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
            type: 'state', common: { name: 'Passive mode power (positive: charge, negative: discharge)', type: 'number', unit: 'W', role: 'level.power', min: -3000, max: 3000, read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.passiveDuration', {
            type: 'state', common: { name: 'Passive mode duration', type: 'number', unit: 's', role: 'level', min: 0, max: 86400, read: true, write: true }, native: {}
        });

        await this.setObjectNotExistsAsync('control.manualTimeNum', {
            type: 'state', common: { name: 'Manual mode time slot (0-9)', type: 'number', role: 'level', min: 0, max: 9, read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.manualStartTime', {
            type: 'state', common: { name: 'Manual mode start time', type: 'string', role: 'text', read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.manualEndTime', {
            type: 'state', common: { name: 'Manual mode end time', type: 'string', role: 'text', read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.manualWeekdays', {
            type: 'state', common: { name: 'Manual mode weekdays (1=Mon, 127=all)', type: 'number', role: 'level', min: 1, max: 127, read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.manualPower', {
            type: 'state', common: { name: 'Manual mode power', type: 'number', unit: 'W', role: 'level.power', min: 0, max: 3000, read: true, write: true }, native: {}
        });
        await this.setObjectNotExistsAsync('control.manualEnable', {
            type: 'state', common: { name: 'Manual mode enable', type: 'boolean', role: 'switch', read: true, write: true }, native: {}
        });

        await this.setObjectNotExistsAsync('network', {
            type: 'channel', common: { name: 'Network information' }, native: {}
        });
        await this.setObjectNotExistsAsync('network.ip', {
            type: 'state', common: { name: 'Device IP', type: 'string', role: 'text', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('network.ssid', {
            type: 'state', common: { name: 'WiFi SSID', type: 'string', role: 'text', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('network.rssi', {
            type: 'state', common: { name: 'WiFi signal strength', type: 'number', unit: 'dBm', role: 'value', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('network.bleState', {
            type: 'state', common: { name: 'BLE state', type: 'string', role: 'text', read: true, write: false }, native: {}
        });

        await this.setObjectNotExistsAsync('energymeter', {
            type: 'channel', common: { name: 'Energy meter' }, native: {}
        });
        await this.setObjectNotExistsAsync('energymeter.ctState', {
            type: 'state', common: { name: 'CT state (0=disconnected, 1=connected)', type: 'number', role: 'value', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energymeter.powerA', {
            type: 'state', common: { name: 'Phase A power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energymeter.powerB', {
            type: 'state', common: { name: 'Phase B power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energymeter.powerC', {
            type: 'state', common: { name: 'Phase C power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });
        await this.setObjectNotExistsAsync('energymeter.powerTotal', {
            type: 'state', common: { name: 'Total power', type: 'number', unit: 'W', role: 'value.power', read: true, write: false }, native: {}
        });

        await this.subscribeStatesAsync('control.*');
        await this.setStateAsync('info.connection', { val: false, ack: true });
    }

    async discoverDevices() {
        this.log.info('Starting device discovery on local network');
        this.log.debug(`Discovery target: UDP port ${this.config.udpPort}, broadcast address: 255.255.255.255`);
        
        // Try multiple discovery attempts with different parameters
        const discoveryAttempts = [
            { method: 'Marstek.GetDevice', params: { ble_mac: '0' } },
            { method: 'Marstek.GetDevice', params: { ble_mac: '' } },
            { method: 'Marstek.GetDevice', params: {} }
        ];

        for (const attempt of discoveryAttempts) {
            try {
                this.log.debug(`Attempting discovery with params: ${JSON.stringify(attempt.params)}`);
                
                const request = {
                    id: this.requestId++,
                    method: attempt.method,
                    params: attempt.params
                };

                const message = Buffer.from(JSON.stringify(request));
                this.log.debug(`Sending discovery request: ${message.toString()}`);
                
                // Send to broadcast address
                this.socket.send(message, 0, message.length, this.config.udpPort, '255.255.255.255', (err) => {
                    if (err) {
                        this.log.error(`Discovery broadcast failed: ${err.message}`);
                    } else {
                        this.log.debug(`Discovery broadcast sent successfully (attempt: ${attempt.method})`);
                    }
                });
                
                // Also send to multicast address as fallback
                this.socket.send(message, 0, message.length, this.config.udpPort, '239.255.255.250', (err) => {
                    if (err) {
                        this.log.debug(`Multicast send failed (non-critical): ${err.message}`);
                    } else {
                        this.log.debug(`Multicast discovery sent successfully`);
                    }
                });
                
                // Wait a bit between attempts
                await new Promise(resolve => setTimeout(resolve, 25000));
            } catch (err) {
                this.log.error(`Error during discovery attempt: ${err.message}`);
            }
        }
        
        this.log.info('Device discovery broadcasts completed');
    }

    async sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.requestId++;
            const targetIP = this.discoveredIP || this.config.ipAddress;
            
            if (!targetIP) {
                this.log.error(`sendRequest ${method}: No target IP configured`);
                reject(new Error(`No target IP configured`));
                return;
            }
            
            const request = { id, method, params };
            const message = Buffer.from(JSON.stringify(request));
    
            const timeoutHandle = () => {
                const pending = this.pendingRequests.get(id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(`Request ${method} timed out`));
                    this.pendingRequests.delete(id);
                }
                this.log.warn(`sendRequest ${method} to ${targetIP}:${this.config.udpPort} timed out`);
            };
    
            const timeout = setTimeout(timeoutHandle, 20000);
    
            this.pendingRequests.set(id, { resolve, reject, timeout });
    
            this.log.debug(`Sending ${method} to ${targetIP}:${this.config.udpPort}`);
            this.socket.send(message, 0, message.length, this.config.udpPort, targetIP, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    this.pendingRequests.delete(id);
                    this.log.error(`sendRequest ${method} to ${targetIP} send error: ${err.message}`);
                    reject(err);
                }
            });
    
            setTimeout(() => {
                this.socket.send(message, 0, message.length, this.config.udpPort, '255.255.255.255', (err) => {
                    if (err) {
                        this.log.debug(`Broadcast retry for ${method} failed: ${err.message}`);
                    }
                });
            }, 1000);
        });
    }

    handleResponse(msgBuffer, rinfo) {
        try {
            const response = JSON.parse(msgBuffer.toString());
            this.log.debug(`Received response from ${rinfo.address}:${rinfo.port}: ${JSON.stringify(response)}`);
            
            if (response.id !== undefined && this.pendingRequests.has(response.id)) {
                const pending = this.pendingRequests.get(response.id);
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(response.id);
                
                if (response.error) {
                    pending.reject(new Error(`API Error ${response.error.code}: ${response.error.message}`));
                    this.log.debug(`Request ${response.id} failed: ${response.error.message}`);
                } else {
                    const resultValue = response.result;
                    pending.resolve(resultValue);
                    this.log.debug(`Request ${response.id} succeeded`);
                    // Clean up pending references to avoid memory leaks
                    pending.timeout = null;
                    pending.resolve = undefined;
                    pending.reject = undefined;
                }
            } else if (response.result && response.result.device) {
                this.log.info(`Discovered device: ${response.result.device} at ${response.result.ip}`);
                this.log.debug(`Device details: ${JSON.stringify(response.result)}`);
                
                // Validate that we got useful information
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

    startPolling() {
        this.log.info('Starting polling loop');
        this.pollInterval = setInterval(() => this.poll(), this.config.pollInterval || 10000);
        this.startSlowPolling();
        this.poll();
    }

    startSlowPolling() {
        this.log.info('Starting slow polling loop (info + network every 10 min)');
        this.slowPollInterval = setInterval(() => this.pollSlow(), 600000);
        this.pollSlow();
    }

    async pollSlow() {
        await this.pollInfoStatus();
        await this.pollWifiStatus();
        await this.pollBLEStatus();
    }

    async pollInfoStatus() {
        try {
            const result = await this.sendRequest('ES.GetInfo', { id: 0 });
            if (result.device !== undefined && result.device !== null) {
                await this.setStateChangedAsync('info.device', { val: result.device, ack: true });
            }
            if (result.ver !== undefined && result.ver !== null) {
                await this.setStateChangedAsync('info.firmware', { val: result.ver, ack: true });
            }
            if ((result.ble_mac !== undefined && result.ble_mac !== null) || (result.wifi_mac !== undefined && result.wifi_mac !== null)) {
                const mac = result.ble_mac || result.wifi_mac;
                await this.setStateChangedAsync('info.mac', { val: mac, ack: true });
            }
        } catch (e) {
            this.log.warn(`ES.GetInfo failed: ${e.message}`);
        }
    }

    async pollWithRetry(fn, maxRetries = 2) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await fn();
                return true;
            } catch (err) {
                lastError = err;
                if (attempt < maxRetries) {
                    this.log.debug(`Poll attempt ${attempt + 1} failed, retrying: ${err.message}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        this.log.warn(`Poll failed after ${maxRetries + 1} attempts: ${lastError.message}`);
        return false;
    }

    async poll() {
        if (this._pollingInProgress) {
            this.log.debug('Poll cycle already in progress, skipping');
            return;
        }
        this._pollingInProgress = true;

        try {
            const results = await Promise.allSettled([
                this.pollWithRetry(() => this.pollESStatus()),
                this.pollWithRetry(() => this.pollBatteryStatus()),
                this.pollWithRetry(() => this.pollPVStatus()),
                this.pollWithRetry(() => this.pollEMStatus()),
                this.pollWithRetry(() => this.pollModeStatus())
            ]);

            const failures = results.filter(r => r.status === 'rejected' || r.value === false).length;

            if (failures === 0) {
                this._pollFailureCount = 0;
                await this.setStateAsync('info.connection', { val: true, ack: true });
            } else {
                this._pollFailureCount++;
                if (this._pollFailureCount >= 3) {
                    this.log.warn(`Poll failed ${this._pollFailureCount} consecutive times, marking disconnected`);
                    await this.setStateAsync('info.connection', { val: false, ack: true });
                }
            }
        } catch (err) {
            this._pollFailureCount++;
            if (this._pollFailureCount >= 3) {
                this.log.warn(`Poll cycle failed ${this._pollFailureCount} consecutive times: ${err.message}`);
                await this.setStateAsync('info.connection', { val: false, ack: true });
            }
        } finally {
            this._pollingInProgress = false;
        }
    }

    async pollESStatus() {
        const result = await this.sendRequest('ES.GetStatus', { id: 0 });

        if (result.pv_power !== undefined && result.pv_power !== null) {
            await this.setStateChangedAsync('power.pv', { val: result.pv_power, ack: true });
        }
        if (result.ongrid_power !== undefined && result.ongrid_power !== null) {
            await this.setStateChangedAsync('power.grid', { val: result.ongrid_power, ack: true });
        }
        if (result.bat_power !== undefined && result.bat_power !== null) {
            await this.setStateChangedAsync('power.battery', { val: result.bat_power, ack: true });
        }
        if (result.offgrid_power !== undefined && result.offgrid_power !== null) {
            await this.setStateChangedAsync('power.load', { val: result.offgrid_power, ack: true });
        }
        if (result.total_pv_energy !== undefined && result.total_pv_energy !== null) {
            await this.setStateChangedAsync('energy.pvTotal', { val: result.total_pv_energy, ack: true });
        }
        if (result.total_grid_output_energy !== undefined && result.total_grid_output_energy !== null) {
            await this.setStateChangedAsync('energy.gridExport', { val: result.total_grid_output_energy, ack: true });
        }
        if (result.total_grid_input_energy !== undefined && result.total_grid_input_energy !== null) {
            await this.setStateChangedAsync('energy.gridImport', { val: result.total_grid_input_energy, ack: true });
        }
        if (result.total_load_energy !== undefined && result.total_load_energy !== null) {
            await this.setStateChangedAsync('energy.loadTotal', { val: result.total_load_energy, ack: true });
        }
        if (result.bat_soc !== undefined && result.bat_soc !== null) {
            await this.setStateChangedAsync('battery.soc', { val: result.bat_soc, ack: true });
        }
    }

    async pollBatteryStatus() {
        const result = await this.sendRequest('Bat.GetStatus', { id: 0 });
        
        if (result.soc !== undefined && result.soc !== null) {
            await this.setStateChangedAsync('battery.soc', { val: result.soc, ack: true });
        }
        if (result.bat_temp !== undefined && result.bat_temp !== null) {
            await this.setStateChangedAsync('battery.temperature', { val: result.bat_temp, ack: true });
        }
        if (result.bat_capacity !== undefined && result.bat_capacity !== null) {
            await this.setStateChangedAsync('battery.capacity', { val: result.bat_capacity, ack: true });
        }
        if (result.rated_capacity !== undefined && result.rated_capacity !== null) {
            await this.setStateChangedAsync('battery.ratedCapacity', { val: result.rated_capacity, ack: true });
        }
        if (result.charg_flag !== undefined && result.charg_flag !== null) {
            await this.setStateChangedAsync('battery.chargingAllowed', { val: result.charg_flag, ack: true });
        }
        if (result.dischrg_flag !== undefined && result.dischrg_flag !== null) {
            await this.setStateChangedAsync('battery.dischargingAllowed', { val: result.dischrg_flag, ack: true });
        }
    }

    async pollPVStatus() {
        const result = await this.sendRequest('PV.GetStatus', { id: 0 });
        if (result.pv_power !== undefined && result.pv_power !== null) {
            await this.setStateChangedAsync('power.pv', { val: result.pv_power, ack: true });
        }
        if (result.pv_voltage !== undefined && result.pv_voltage !== null) {
            await this.setStateChangedAsync('power.pvVoltage', { val: result.pv_voltage, ack: true });
        }
        if (result.pv_current !== undefined && result.pv_current !== null) {
            await this.setStateChangedAsync('power.pvCurrent', { val: result.pv_current, ack: true });
        }
    }

    async pollWifiStatus() {
        try {
            const result = await this.sendRequest('Wifi.GetStatus', { id: 0 });

            if (result.sta_ip !== undefined && result.sta_ip !== null) {
                await this.setStateChangedAsync('network.ip', { val: result.sta_ip, ack: true });
            }
            if (result.ssid !== undefined && result.ssid !== null) {
                await this.setStateChangedAsync('network.ssid', { val: result.ssid, ack: true });
            }
            if (result.rssi !== undefined && result.rssi !== null) {
                await this.setStateChangedAsync('network.rssi', { val: result.rssi, ack: true });
            }
        } catch (e) {
            this.log.warn(`Wifi.GetStatus failed: ${e.message}`);
        }
    }

    async pollBLEStatus() {
        try {
            const result = await this.sendRequest('BLE.GetStatus', { id: 0 });
            if (result.state !== undefined && result.state !== null) {
                await this.setStateChangedAsync('network.bleState', { val: result.state, ack: true });
            }
        } catch (e) {
            this.log.warn(`BLE.GetStatus failed: ${e.message}`);
        }
    }

    async pollEMStatus() {
        const result = await this.sendRequest('EM.GetStatus', { id: 0 });
        if (result.ct_state !== undefined && result.ct_state !== null) {
            await this.setStateChangedAsync('energymeter.ctState', { val: result.ct_state, ack: true });
        }
        if (result.a_power !== undefined && result.a_power !== null) {
            await this.setStateChangedAsync('energymeter.powerA', { val: result.a_power, ack: true });
        }
        if (result.b_power !== undefined && result.b_power !== null) {
            await this.setStateChangedAsync('energymeter.powerB', { val: result.b_power, ack: true });
        }
        if (result.c_power !== undefined && result.c_power !== null) {
            await this.setStateChangedAsync('energymeter.powerC', { val: result.c_power, ack: true });
        }
        if (result.total_power !== undefined && result.total_power !== null) {
            await this.setStateChangedAsync('energymeter.powerTotal', { val: result.total_power, ack: true });
        }
    }

    async pollModeStatus() {
        const result = await this.sendRequest('ES.GetMode', { id: 0 });
        if (result.mode !== undefined && result.mode !== null) {
            await this.setStateChangedAsync('control.mode', { val: result.mode, ack: true });
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const stateName = id.split('.').pop();
        
        try {
            const modeState = await this.getStateAsync('control.mode');
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
                this.log.info(`Successfully set operating mode to ${mode}`);
                await this.setStateAsync(id, { val: mode, ack: true });
            } else if (modeState?.val === 'Manual' && stateName.startsWith('control.manual')) {
                const timeNum = await this.getStateAsync('control.manualTimeNum');
                const startTime = await this.getStateAsync('control.manualStartTime');
                const endTime = await this.getStateAsync('control.manualEndTime');
                const weekdays = await this.getStateAsync('control.manualWeekdays');
                const power = await this.getStateAsync('control.manualPower');
                const enable = await this.getStateAsync('control.manualEnable');
                const manual_cfg = {
                    time_num: timeNum?.val || 0,
                    start_time: startTime?.val || '00:00',
                    end_time: endTime?.val || '23:59',
                    week_set: weekdays?.val || 127,
                    power: power?.val || 100,
                    enable: enable?.val ? 1 : 0
                };
                await this.sendRequest('ES.SetMode', { id: 0, config: { mode: 'Manual', manual_cfg } });
                await this.setStateAsync(id, { val: state.val, ack: true });
            }
        } catch (err) {
            this.log.error(`Failed to set ${stateName}: ${err.message}`);
        }
    }

    async onMessage(obj) {
        if (obj.command === 'discover') {
            await this.discoverDevices();
            if (obj.callback) this.sendTo(obj.from, obj.command, { 
                success: !!this.discoveredIP, 
                ipAddress: this.discoveredIP || null 
            }, obj.callback);
        }
    }

    onUnload(callback) {
        try {
            this.log.info('Shutting down Marstek Venus adapter');
            
            if (this.pollInterval) clearInterval(this.pollInterval);
            if (this.slowPollInterval) clearInterval(this.slowPollInterval);
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

if (module.parent) {
    module.exports = (options) => new MarstekVenusAdapter(options);
} else {
    new MarstekVenusAdapter();
}
