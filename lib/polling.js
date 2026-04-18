"use strict";

const DEVICE_CAPABILITIES = {
	VenusC: { hasPV: false, hasBat: true, hasEM: true, hasES: true },
	"VenusC 3.0": { hasPV: false, hasBat: true, hasEM: true, hasES: true },
	VenusE: { hasPV: false, hasBat: true, hasEM: true, hasES: true },
	"VenusE 3.0": { hasPV: false, hasBat: true, hasEM: true, hasES: true },
	VenusD: { hasPV: true, hasBat: true, hasEM: true, hasES: true },
	VenusA: { hasPV: true, hasBat: true, hasEM: true, hasES: true },
};

const Polling = {
	hasPVSupport() {
		const model = this._discoveredDeviceModel || this.config.deviceModel;
		if (!model) {
			return true;
		}
		this.log.debug(`model: ${model}`);
		const caps = DEVICE_CAPABILITIES[model];
		return caps ? caps.hasPV : true;
	},

	async pollSlow() {
		if (this._slowPollingInProgress) {
			this.log.debug("Slow poll already in progress, skipping");
			return;
		}
		this._slowPollingInProgress = true;
		try {
			await this.pollWifiStatus();
			await this.pollBLEStatus();
		} finally {
			this._slowPollingInProgress = false;
		}
	},

	async pollWithRetry(fn, maxRetries = 2) {
		let lastError;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				await fn();
				return true;
			} catch (err) {
				lastError = err;
				if (attempt < maxRetries) {
					const delay = 1000 * Math.pow(2, attempt);
					this.log.debug(`Poll attempt ${attempt + 1} failed, retrying in ${delay}ms: ${err.message}`);
					await new Promise(resolve => this.setTimeout(resolve, delay));
				}
			}
		}
		this.log.warn(`Poll failed after ${maxRetries + 1} attempts: ${lastError.message}`);
		return false;
	},

	async poll() {
		if (this._pollingInProgress) {
			this.log.debug("Poll cycle already in progress, skipping");
			return;
		}
		this._pollingInProgress = true;

		try {
			const pollTasks = [
				this.pollWithRetry(() => this.pollESStatus()),
				this.pollWithRetry(() => this.pollBatteryStatus()),
				this.pollWithRetry(() => this.pollEMStatus()),
				this.pollWithRetry(() => this.pollModeStatus()),
			];

			if (this.hasPVSupport()) {
				pollTasks.push(this.pollWithRetry(() => this.pollPVStatus()));
			} else {
				this.log.debug("Skipping PV polling - device does not support PV");
			}

			const results = await Promise.allSettled(pollTasks);

			const failures = results.filter(r => r.status === "rejected" || r.value === false).length;

			if (failures === 0) {
				this._pollFailureCount = 0;
				await this.setState("info.connection", { val: true, ack: true });
			} else {
				this._pollFailureCount++;
				if (this._pollFailureCount >= 3) {
					this.log.warn(`Poll failed ${this._pollFailureCount} consecutive times, marking disconnected`);
					await this.setState("info.connection", { val: false, ack: true });
				}
			}
		} catch (err) {
			this._pollFailureCount++;
			if (this._pollFailureCount >= 3) {
				this.log.warn(`Poll cycle failed ${this._pollFailureCount} consecutive times: ${err.message}`);
				await this.setState("info.connection", { val: false, ack: true });
			}
		} finally {
			this._pollingInProgress = false;
		}
	},

	async pollPower() {
		try {
			const result = await this.sendRequest("ES.GetStatus", { id: 0 });
			this.log.debug(`pollPower response: ${JSON.stringify(result)}`);
			if (result.pv_power !== undefined && result.pv_power !== null) {
				await this.setStateChangedAsync("power.pv", { val: result.pv_power, ack: true });
			}
			if (result.ongrid_power !== undefined && result.ongrid_power !== null) {
				await this.setStateChangedAsync("power.grid", { val: result.ongrid_power, ack: true });
			}
			if (result.bat_power !== undefined && result.bat_power !== null) {
				await this.setStateChangedAsync("power.battery", { val: result.bat_power, ack: true });
			}
			if (result.offgrid_power !== undefined && result.offgrid_power !== null) {
				await this.setStateChangedAsync("power.load", { val: result.offgrid_power, ack: true });
			}
		} catch (e) {
			this.log.warn(`pollPower failed: ${e.message}`);
		}
	},

	async pollESStatus() {
		const result = await this.sendRequest("ES.GetStatus", { id: 0 });

		if (result.pv_power !== undefined && result.pv_power !== null) {
			await this.setStateChangedAsync("power.pv", { val: result.pv_power, ack: true });
		}
		if (result.ongrid_power !== undefined && result.ongrid_power !== null) {
			await this.setStateChangedAsync("power.grid", { val: result.ongrid_power, ack: true });
		}
		if (result.bat_power !== undefined && result.bat_power !== null) {
			await this.setStateChangedAsync("power.battery", { val: result.bat_power, ack: true });
		}
		if (result.offgrid_power !== undefined && result.offgrid_power !== null) {
			await this.setStateChangedAsync("power.load", { val: result.offgrid_power, ack: true });
		}
		if (result.total_pv_energy !== undefined && result.total_pv_energy !== null) {
			await this.setStateChangedAsync("energy.pvTotal", { val: result.total_pv_energy, ack: true });
		}
		if (result.total_grid_output_energy !== undefined && result.total_grid_output_energy !== null) {
			await this.setStateChangedAsync("energy.gridExport", { val: result.total_grid_output_energy, ack: true });
		}
		if (result.total_grid_input_energy !== undefined && result.total_grid_input_energy !== null) {
			await this.setStateChangedAsync("energy.gridImport", { val: result.total_grid_input_energy, ack: true });
		}
		if (result.total_load_energy !== undefined && result.total_load_energy !== null) {
			await this.setStateChangedAsync("energy.loadTotal", { val: result.total_load_energy, ack: true });
		}
		if (result.bat_soc !== undefined && result.bat_soc !== null) {
			await this.setStateChangedAsync("battery.soc", { val: result.bat_soc, ack: true });
		}
	},

	async pollBatteryStatus() {
		const result = await this.sendRequest("Bat.GetStatus", { id: 0 });

		if (result.soc !== undefined && result.soc !== null) {
			await this.setStateChangedAsync("battery.soc", { val: result.soc, ack: true });
		}
		if (result.bat_temp !== undefined && result.bat_temp !== null) {
			await this.setStateChangedAsync("battery.temperature", { val: result.bat_temp, ack: true });
		}
		if (result.bat_capacity !== undefined && result.bat_capacity !== null) {
			await this.setStateChangedAsync("battery.capacity", { val: result.bat_capacity, ack: true });
		}
		if (result.rated_capacity !== undefined && result.rated_capacity !== null) {
			await this.setStateChangedAsync("battery.ratedCapacity", { val: result.rated_capacity, ack: true });
		}
		if (result.charg_flag !== undefined && result.charg_flag !== null) {
			await this.setStateChangedAsync("battery.chargingAllowed", { val: result.charg_flag, ack: true });
		}
		if (result.dischrg_flag !== undefined && result.dischrg_flag !== null) {
			await this.setStateChangedAsync("battery.dischargingAllowed", { val: result.dischrg_flag, ack: true });
		}
	},

	async pollPVStatus() {
		const result = await this.sendRequest("PV.GetStatus", { id: 0 });
		if (result.pv_power !== undefined && result.pv_power !== null) {
			await this.setStateChangedAsync("power.pv", { val: result.pv_power, ack: true });
		}
		if (result.pv_voltage !== undefined && result.pv_voltage !== null) {
			await this.setStateChangedAsync("power.pvVoltage", { val: result.pv_voltage, ack: true });
		}
		if (result.pv_current !== undefined && result.pv_current !== null) {
			await this.setStateChangedAsync("power.pvCurrent", { val: result.pv_current, ack: true });
		}
	},

	async pollWifiStatus() {
		try {
			const result = await this.sendRequest("Wifi.GetStatus", { id: 0 });

			if (result.sta_ip !== undefined && result.sta_ip !== null) {
				await this.setStateChangedAsync("network.ip", { val: result.sta_ip, ack: true });
			}
			if (result.ssid !== undefined && result.ssid !== null) {
				await this.setStateChangedAsync("network.ssid", { val: result.ssid, ack: true });
			}
			if (result.rssi !== undefined && result.rssi !== null) {
				await this.setStateChangedAsync("network.rssi", { val: result.rssi, ack: true });
			}
		} catch (e) {
			this.log.warn(`Wifi.GetStatus failed: ${e.message}`);
		}
	},

	async pollBLEStatus() {
		try {
			const result = await this.sendRequest("BLE.GetStatus", { id: 0 });
			if (result.state !== undefined && result.state !== null) {
				await this.setStateChangedAsync("network.bleState", { val: result.state, ack: true });
			}
		} catch (e) {
			this.log.warn(`BLE.GetStatus failed: ${e.message}`);
		}
	},

	async pollEMStatus() {
		const result = await this.sendRequest("EM.GetStatus", { id: 0 });
		if (result.ct_state !== undefined && result.ct_state !== null) {
			await this.setStateChangedAsync("energymeter.ctState", { val: result.ct_state, ack: true });
		}
		if (result.a_power !== undefined && result.a_power !== null) {
			await this.setStateChangedAsync("energymeter.powerA", { val: result.a_power, ack: true });
		}
		if (result.b_power !== undefined && result.b_power !== null) {
			await this.setStateChangedAsync("energymeter.powerB", { val: result.b_power, ack: true });
		}
		if (result.c_power !== undefined && result.c_power !== null) {
			await this.setStateChangedAsync("energymeter.powerC", { val: result.c_power, ack: true });
		}
		if (result.total_power !== undefined && result.total_power !== null) {
			await this.setStateChangedAsync("energymeter.powerTotal", { val: result.total_power, ack: true });
		}
	},

	async pollModeStatus() {
		const result = await this.sendRequest("ES.GetMode", { id: 0 });
		if (result.mode !== undefined && result.mode !== null) {
			await this.setStateChangedAsync("control.mode", { val: result.mode, ack: true });
		}
	},
};

module.exports = { Polling };
