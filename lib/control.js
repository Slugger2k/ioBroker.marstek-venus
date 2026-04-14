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
				const mode = state.val;
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
				}

				await this.sendRequest("ES.SetMode", { id: 0, config });
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
				await this.sendRequest("ES.SetMode", { id: 0, config: { mode: "Manual", manual_cfg } });
				await this.setState(id, { val: state.val, ack: true });
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
		await this.sendRequest("Marstek.SetTargetPower", { power: clampedValue });
	},
};

module.exports = { Control };
