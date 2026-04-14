"use strict";

/**
 *
 */
class Adapter {
	/**
	 *
	 */
	async initStates() {
		await this.setObjectNotExistsAsync("info.device", {
			type: "state",
			common: { name: "Device model", type: "string", role: "info.model", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("info.firmware", {
			type: "state",
			common: { name: "Firmware version", type: "string", role: "info.firmware", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("info.mac", {
			type: "state",
			common: { name: "Device MAC", type: "string", role: "info.mac", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("info.connection", {
			type: "state",
			common: { name: "Connected", type: "boolean", role: "indicator.connected", read: true, write: false },
			native: {},
		});

		await this.setObjectNotExistsAsync("battery.soc", {
			type: "state",
			common: {
				name: "State of charge",
				type: "number",
				unit: "%",
				role: "value.battery",
				min: 0,
				max: 100,
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("battery.temperature", {
			type: "state",
			common: {
				name: "Battery temperature",
				type: "number",
				unit: "°C",
				role: "value.temperature",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("battery.capacity", {
			type: "state",
			common: {
				name: "Remaining capacity",
				type: "number",
				unit: "Wh",
				role: "value.energy",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("battery.ratedCapacity", {
			type: "state",
			common: {
				name: "Rated capacity",
				type: "number",
				unit: "Wh",
				role: "value.energy",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("battery.chargingAllowed", {
			type: "state",
			common: { name: "Charging allowed", type: "boolean", role: "indicator", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("battery.dischargingAllowed", {
			type: "state",
			common: { name: "Discharging allowed", type: "boolean", role: "indicator", read: true, write: false },
			native: {},
		});

		await this.setObjectNotExistsAsync("power.pv", {
			type: "state",
			common: { name: "PV power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("power.pvVoltage", {
			type: "state",
			common: { name: "PV voltage", type: "number", unit: "V", role: "value.voltage", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("power.pvCurrent", {
			type: "state",
			common: { name: "PV current", type: "number", unit: "A", role: "value.current", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("power.grid", {
			type: "state",
			common: { name: "Grid power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("power.battery", {
			type: "state",
			common: { name: "Battery power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("power.load", {
			type: "state",
			common: { name: "Load power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});

		await this.setObjectNotExistsAsync("energy.pvTotal", {
			type: "state",
			common: {
				name: "Total PV energy",
				type: "number",
				unit: "Wh",
				role: "value.energy",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("energy.gridImport", {
			type: "state",
			common: {
				name: "Total grid import",
				type: "number",
				unit: "Wh",
				role: "value.energy",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("energy.gridExport", {
			type: "state",
			common: {
				name: "Total grid export",
				type: "number",
				unit: "Wh",
				role: "value.energy",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("energy.loadTotal", {
			type: "state",
			common: {
				name: "Total load energy",
				type: "number",
				unit: "Wh",
				role: "value.energy",
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("control.mode", {
			type: "state",
			common: {
				name: "Operating mode",
				type: "string",
				role: "value",
				read: true,
				write: true,
				states: { Auto: "Auto", AI: "AI", Manual: "Manual", Passive: "Passive" },
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("control.passivePower", {
			type: "state",
			common: {
				name: "Passive mode power (positive: charge, negative: discharge)",
				type: "number",
				unit: "W",
				role: "level.power",
				min: -3000,
				max: 3000,
				read: true,
				write: true,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("control.passiveDuration", {
			type: "state",
			common: {
				name: "Passive mode duration",
				type: "number",
				unit: "s",
				role: "level",
				min: 0,
				max: 86400,
				read: true,
				write: true,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync("control.manualTimeNum", {
			type: "state",
			common: {
				name: "Manual mode time slot (0-9)",
				type: "number",
				role: "level",
				min: 0,
				max: 9,
				read: true,
				write: true,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("control.manualStartTime", {
			type: "state",
			common: { name: "Manual mode start time", type: "string", role: "text", read: true, write: true },
			native: {},
		});
		await this.setObjectNotExistsAsync("control.manualEndTime", {
			type: "state",
			common: { name: "Manual mode end time", type: "string", role: "text", read: true, write: true },
			native: {},
		});
		await this.setObjectNotExistsAsync("control.manualWeekdays", {
			type: "state",
			common: {
				name: "Manual mode weekdays (1=Mon, 127=all)",
				type: "number",
				role: "level",
				min: 1,
				max: 127,
				read: true,
				write: true,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("control.manualPower", {
			type: "state",
			common: {
				name: "Manual mode power",
				type: "number",
				unit: "W",
				role: "level.power",
				min: 0,
				max: 3000,
				read: true,
				write: true,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("control.manualEnable", {
			type: "state",
			common: { name: "Manual mode enable", type: "boolean", role: "switch", read: true, write: true },
			native: {},
		});

		await this.setObjectNotExistsAsync("network.ip", {
			type: "state",
			common: { name: "Device IP", type: "string", role: "info.ip", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("network.ssid", {
			type: "state",
			common: { name: "WiFi SSID", type: "string", role: "text", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("network.rssi", {
			type: "state",
			common: {
				name: "WiFi signal strength",
				type: "number",
				unit: "dBm",
				role: "value",
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("network.bleState", {
			type: "state",
			common: { name: "BLE state", type: "string", role: "text", read: true, write: false },
			native: {},
		});

		await this.setObjectNotExistsAsync("energymeter.ctState", {
			type: "state",
			common: {
				name: "CT state",
				type: "number",
				role: "value",
				states: { 0: "disconnected", 1: "connected" },
				read: true,
				write: false,
			},
			native: {},
		});
		await this.setObjectNotExistsAsync("energymeter.powerA", {
			type: "state",
			common: { name: "Phase A power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("energymeter.powerB", {
			type: "state",
			common: { name: "Phase B power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("energymeter.powerC", {
			type: "state",
			common: { name: "Phase C power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});
		await this.setObjectNotExistsAsync("energymeter.powerTotal", {
			type: "state",
			common: { name: "Total power", type: "number", unit: "W", role: "value.power", read: true, write: false },
			native: {},
		});

		await this.subscribeStatesAsync("control.*");
		await this.setState("info.connection", { val: false, ack: true });
	}
}

module.exports = { Adapter };
