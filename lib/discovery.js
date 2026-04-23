"use strict";

const Discovery = {
	async discoverDevices() {
		this.log.info("Starting device discovery on local network");
		this.log.debug(`Discovery target: UDP port ${this.config.udpPort}, broadcast address: 255.255.255.255`);

		const discoveryAttempts = [{ method: "Marstek.GetDevice", params: { ble_mac: "0" } }];

		for (const attempt of discoveryAttempts) {
			try {
				this.log.debug(`Attempting discovery with params: ${JSON.stringify(attempt.params)}`);

				const request = {
					id: this._requestId++,
					method: attempt.method,
					params: attempt.params,
				};

				const message = Buffer.from(JSON.stringify(request));
				this.log.debug(`Sending discovery request: ${message.toString()}`);

				this._socket.send(message, 0, message.length, this.config.udpPort, "255.255.255.255", err => {
					if (err) {
						this.log.error(`Discovery broadcast failed: ${err.message}`);
					} else {
						this.log.debug(`Discovery broadcast sent successfully (attempt: ${attempt.method})`);
					}
				});

				this._socket.send(message, 0, message.length, this.config.udpPort, "239.255.255.250", err => {
					if (err) {
						this.log.debug(`Multicast send failed (non-critical): ${err.message}`);
					} else {
						this.log.debug(`Multicast discovery sent successfully`);
					}
				});

				await new Promise(resolve => this.setTimeout(resolve, 5000));
			} catch (err) {
				this.log.error(`Error during discovery attempt: ${err.message}`);
			}
		}

		this.log.info("Device discovery broadcasts completed");
	},
};

module.exports = { Discovery };
