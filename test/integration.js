"use strict";

const path = require("node:path");
const dgram = require("node:dgram");
const { tests } = require("@iobroker/testing");

let mockServer;

// Initialize Mock Server globally for the test file
function startMockServer() {
	return new Promise(resolve => {
		mockServer = dgram.createSocket("udp4");
		mockServer.on("message", (msg, rinfo) => {
			try {
				const request = JSON.parse(msg.toString());
				let response;

				if (request.method === "Marstek.GetDevice") {
					response = {
						id: request.id,
						src: "VenusA-MOCK",
						result: {
							device: "Venus A",
							ip: "127.0.0.1",
							ver: 100,
							wifi_mac: "AA:BB:CC:DD:EE:FF",
						},
					};
				} else if (request.method === "ES.GetStatus") {
					response = {
						id: request.id,
						result: {
							pv_power: 100,
							ongrid_power: 200,
							bat_power: 300,
							offgrid_power: 400,
							bat_soc: 50,
						},
					};
				} else if (request.method === "Bat.GetStatus") {
					response = {
						id: request.id,
						result: { soc: 50, bat_temp: 25 },
					};
				} else if (request.method === "EM.GetStatus") {
					response = {
						id: request.id,
						result: { total_power: 1000 },
					};
				} else if (request.method === "ES.GetMode") {
					response = {
						id: request.id,
						result: { mode: 1, bat_soc: 50 },
					};
				} else if (request.method === "PV.GetStatus") {
					response = {
						id: request.id,
						result: { pv1_power: 1000 },
					};
				}

				if (response) {
					const responseMsg = Buffer.from(JSON.stringify(response));
					mockServer.send(responseMsg, 0, responseMsg.length, rinfo.port, rinfo.address);
				}
			} catch (err) {
				console.error(`[MOCK SERVER ERROR] ${err.message}`);
			}
		});
		mockServer.bind(30000, "0.0.0.0", () => {
			mockServer.setBroadcast(true);
			resolve();
		});
	});
}

// Start mock server before running tests
startMockServer().then(() => {
	// Run integration tests
	tests.integration(path.join(__dirname, ".."), {
		allowedExitCodes: [0],
	});
});
