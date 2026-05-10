"use strict";

const Control = {
	async onStateChange(id, state) {
		if (!state || state.ack) {
			return;
		}

		const stateName = id.split(".").pop();

		try {
			const modeState = await this.getStateAsync("control.mode");
			if (stateName === "mode") {
				const requestedMode = String(state.val || "").trim();
				const mode = requestedMode === "UPS" ? "Ups" : requestedMode;
				let config = { mode };

				if (mode === "Auto") {
					config.auto_cfg = { enable: 1 };
				} else if (mode === "AI") {
					config.ai_cfg = { enable: 1 };
				} else if (mode === "Passive") {
					const power = await this.getStateAsync("control.passivePower");
					const duration = await this.getStateAsync("control.passiveDuration");
					config.passive_cfg = {
						power: power?.val || 0,
						cd_time: duration?.val || 300,
					};
				} else if (mode === "Manual") {
					const timeNum = await this.getStateAsync("control.manualTimeNum");
					const startTime = await this.getStateAsync("control.manualStartTime");
					const endTime = await this.getStateAsync("control.manualEndTime");
					const weekdays = await this.getStateAsync("control.manualWeekdays");
					const power = await this.getStateAsync("control.manualPower");
					const enable = await this.getStateAsync("control.manualEnable");
					config.manual_cfg = {
						time_num: timeNum?.val || 0,
						start_time: startTime?.val || "00:00",
						end_time: endTime?.val || "23:59",
						week_set: weekdays?.val || 127,
						power: power?.val || 100,
						enable: enable?.val ? 1 : 0,
					};
				} else if (mode === "Ups") {
					config.ups_cfg = { enable: 1 };
				} else {
					this.log.warn(`Ignoring unsupported operating mode: ${requestedMode}`);
					return;
				}

				await this.sendRequestWithRetry("ES.SetMode", { id: 0, config });
				this.log.info(`Successfully set operating mode to ${mode}`);
				await this.setState(id, { val: mode, ack: true });
			} else if (modeState?.val === "Manual" && id.startsWith("control.manual")) {
				const timeNum = await this.getStateAsync("control.manualTimeNum");
				const startTime = await this.getStateAsync("control.manualStartTime");
				const endTime = await this.getStateAsync("control.manualEndTime");
				const weekdays = await this.getStateAsync("control.manualWeekdays");
				const power = await this.getStateAsync("control.manualPower");
				const enable = await this.getStateAsync("control.manualEnable");
				const manual_cfg = {
					time_num: timeNum?.val || 0,
					start_time: startTime?.val || "00:00",
					end_time: endTime?.val || "23:59",
					week_set: weekdays?.val || 127,
					power: power?.val || 100,
					enable: enable?.val ? 1 : 0,
				};
				await this.sendRequestWithRetry("ES.SetMode", { id: 0, config: { mode: "Manual", manual_cfg } });
				await this.setState(id, { val: state.val, ack: true });
			} else if (stateName === "dodValue") {
				const dodValue = Number(state.val);
				const clampedValue = Math.min(Math.max(dodValue, 30), 88);
				await this.sendRequestWithRetry("DOD.SET", { id: 0, value: clampedValue });
				await this.setState(id, { val: clampedValue, ack: true });
			} else if (stateName === "bleBroadcastEnabled") {
				const enable = state.val ? 0 : 1;
				await this.sendRequestWithRetry("Ble.Adv", { id: 0, enable });
				await this.setState(id, { val: Boolean(state.val), ack: true });
			} else if (stateName === "ledState") {
				const ledState = state.val ? 1 : 0;
				await this.sendRequestWithRetry("Led.Ctrl", { id: 0, state: ledState });
				await this.setState(id, { val: Boolean(state.val), ack: true });
			}
		} catch (err) {
			this.log.error(`Failed to set ${stateName}: ${err.message}`);
		}
	},

	async setControlTarget(value) {
		if (value == null) {
			return;
		}
		const clampedValue = Math.min(Math.max(value, -1500), 1500);
		await this.sendRequestWithRetry("Marstek.SetTargetPower", { power: clampedValue });
	},
};

module.exports = { Control };
