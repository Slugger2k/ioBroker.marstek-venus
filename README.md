[![License](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/Slugger2k/ioBroker.marstek-venus/blob/main/LICENSE)
[![npm version](https://img.shields.io/npm/v/iobroker.marstek-venus.svg)](https://www.npmjs.com/package/iobroker.marstek-venus)
[![Downloads](https://img.shields.io/npm/dt/iobroker.marstek-venus.svg)](https://www.npmjs.com/package/iobroker.marstek-venus)
[![Build Status](https://github.com/Slugger2k/ioBroker.marstek-venus/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/Slugger2k/ioBroker.marstek-venus/actions)

# ioBroker.marstek-venus Adapter

The ioBroker.marstek-venus adapter provides full integration with Marstek Venus series energy storage systems, implementing the official Open API for complete device control and monitoring.

## Supported Devices
- ✅ Venus A
- ✅ Venus C
- ✅ Venus D
- ✅ Venus E

## Key Features

- ✅ **Full device auto-discovery** on local network
- ✅ **3-tier polling system** for optimized updates:
  - **Fast poll** (default 5s): Power values (pv, grid, battery, load)
  - **Normal poll** (default 20s): All status values
   - **Slow poll** (10min): Network status
- ✅ **Request deduplication** - prevents overlapping requests
- ✅ **Automatic retry** - 3 retries with 3000ms timeout per request
- ✅ **Complete state coverage** (battery, power, energy, network, device info)
- ✅ **Full control support** (Auto/AI/Manual/Passive modes)
- ✅ **Manual mode configuration** (time slots, weekdays, power, enable/disable)
- ✅ **Passive mode configuration** (power, duration)
- ✅ **Energy monitoring** (PV, grid import/export, load)
- ✅ **Network status monitoring** (IP, WiFi, BLE)
- ✅ **Energy meter with phase measurements** (A/B/C phases)

## Installation

1. **Enable Open API** in Marstek mobile app and note UDP port (default 30000)
2. **Install adapter** via ioBroker admin interface
3. **Configure instance**:
   - Auto discovery (recommended) or manual IP entry
   - Set UDP port as configured in app
   - Adjust poll interval and fastPollInterval (default 5000ms)
4. **Save and start** adapter

## Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| **ipAddress** | Leave empty for auto-discovery, or enter device IP | (empty) |
| **udpPort** | UDP port for communication | 30000 |
| **pollInterval** | Normal poll interval for all status values (ms) | 20000 |
| **fastPollInterval** | Fast poll interval for power values (ms) | 5000 |
| **requestTimeout** | Request timeout before retry (ms) | 3000 |
| **maxRetries** | Max retry attempts per request | 3 |
| **autoDiscovery** | Enable automatic device discovery | true |

## States Documentation

### Battery States
- **`marstek-venus.0.battery.soc`** - State of charge (0-100%) | %, ro
- **`marstek-venus.0.battery.temperature`** - Battery temperature in °C | °C, ro
- **`marstek-venus.0.battery.capacity`** - Remaining capacity in Wh | Wh, ro
- **`marstek-venus.0.battery.ratedCapacity`** - Rated capacity in Wh | Wh, ro
- **`marstek-venus.0.battery.chargingAllowed`** - Charging permitted (true/false) | bool, rw
- **`marstek-venus.0.battery.dischargingAllowed`** - Discharging permitted (true/false) | bool, rw

### Power States
- **`marstek-venus.0.power.pv`** - PV power generation in W | W, ro
- **`marstek-venus.0.power.pvVoltage`** - PV voltage in V | V, ro
- **`marstek-venus.0.power.pvCurrent`** - PV current in A | A, ro
- **`marstek-venus.0.power.grid`** - Grid power flow (positive=import, negative=export) | W, ro
- **`marstek-venus.0.power.battery`** - Battery power flow in W | W, ro
- **`marstek-venus.0.power.load`** - Load consumption in W | W, ro

### Energy States
- **`marstek-venus.0.energy.pvTotal`** - Total PV energy generated in Wh | Wh, ro
- **`marstek-venus.0.energy.gridImport`** - Total grid energy imported in Wh | Wh, ro
- **`marstek-venus.0.energy.gridExport`** - Total grid energy exported in Wh | Wh, ro
- **`marstek-venus.0.energy.loadTotal`** - Total load energy consumed in Wh | Wh, ro

### Control States
- **`marstek-venus.0.control.mode`** - Operating mode (Auto/AI/Manual/Passive) | enum, rw
- **`marstek-venus.0.control.passivePower`** - Passive mode power target in W (positive=charge, negative=discharge) | W, rw
- **`marstek-venus.0.control.passiveDuration`** - Passive mode duration in seconds | s, rw
- **`marstek-venus.0.control.manualTimeNum`** - Manual mode time slot (0-9) | number, rw
- **`marstek-venus.0.control.manualStartTime`** - Manual mode start time (HH:MM) | string, rw
- **`marstek-venus.0.control.manualEndTime`** - Manual mode end time (HH:MM) | string, rw
- **`marstek-venus.0.control.manualWeekdays`** - Manual mode weekdays (1=Mon, 127=all) | number, rw
- **`marstek-venus.0.control.manualPower`** - Manual mode power target in W | W, rw
- **`marstek-venus.0.control.manualEnable`** - Enable manual mode schedule (true/false) | bool, rw

### Network States
- **`marstek-venus.0.network.ip`** - Device IP address | ip, ro
- **`marstek-venus.0.network.ssid`** - WiFi SSID | string, ro
- **`marstek-venus.0.network.rssi`** - WiFi signal strength in dBm | dBm, ro
- **`marstek-venus.0.network.bleState`** - BLE connection state (connected/disconnected) | enum, ro

### Info States
- **`marstek-venus.0.info.device`** - Device model (Venus A, B, C, D, E) | string, ro
- **`marstek-venus.0.info.firmware`** - Firmware version number | string, ro
- **`marstek-venus.0.info.mac`** - Device MAC address | mac, ro
- **`marstek-venus.0.info.connection`** - Connection status (true/false) | bool, ro

### Energy Meter States
- **`marstek-venus.0.energymeter.ctState`** - CT sensor connection state (0=disconnected, 1=connected) | enum, ro
- **`marstek-venus.0.energymeter.powerA`** - Phase A power in W | W, ro
- **`marstek-venus.0.energymeter.powerB`** - Phase B power in W | W, ro
- **`marstek-venus.0.energymeter.powerC`** - Phase C power in W | W, ro
- **`marstek-venus.0.energymeter.powerTotal`** - Total three-phase power in W | W, ro

## Control and Operation

### Switching Modes
- **Auto**: Fully automatic operation based on device algorithms
- **AI**: AI-powered optimization mode
- **Manual**: Schedule-based manual control with 10 time slots
- **Passive**: Maintain battery at specified power level for specified duration

### Manual Mode Configuration
Manual mode uses 10 time slots per day (0-9). Configure:
- **`control.manualTimeNum`** - Select time slot (0-9)
- **`control.manualStartTime`** - Start time for the slot (HH:MM)
- **`control.manualEndTime`** - End time for the slot (HH:MM)
- **`control.manualWeekdays`** - Bitmask for weekdays (1=Mon, 127=all)
- **`control.manualPower`** - Target power for the slot in W
- **`control.manualEnable`** - Enable this time slot

### Passive Mode Configuration
- **`control.passivePower`** - Target power level in W (positive=charge, negative=discharge)
- **`control.passiveDuration`** - Duration in seconds (0-86400)

## API Implementation

The adapter implements 100% of the official Marstek Open API Revision 1.0:

- `Marstek.GetDevice` - Device discovery and information
- `Wifi.GetStatus` - WiFi connection status
- `BLE.GetStatus` - Bluetooth status
- `Bat.GetStatus` - Battery detailed status
- `PV.GetStatus` - PV array status
- `ES.GetStatus` - Energy storage system status
- `ES.GetMode` - Current operating mode
- `ES.SetMode` - Set operating mode and configuration
- `EM.GetStatus` - Energy meter measurements

## Troubleshooting

### Discovery Issues
- Ensure UDP port 30000 is open and matches mobile app configuration
- Check that device is on the same network subnet
- Try manually entering IP address if auto-discovery fails
- Verify device WiFi connection is working

### Connection Problems
- Check firewall settings allowing UDP traffic
- Verify network connectivity to device
- Restart adapter and device
- Check WiFi signal strength (network.rssi)

### Polling Issues
- Adjust `fastPollInterval` for power value update frequency (default 5000ms)
- Adjust `pollInterval` for normal status update frequency (default 20000ms)
- Adjust `requestTimeout` if device needs more time to respond (default 3000ms)
- Increase `maxRetries` for unreliable network connections
- Slow poll runs every 10 minutes for network status

### State Updates Not Working
- Verify control states are writable (some are read-only)
- Check that mode changes are properly configured
- Ensure manual mode settings are valid


## License

MIT License

Copyright (c) 2024-2026 ioBroker Community

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Changelog
### 0.1.13 (2026-04-12)
- Added Venus A device support to adapter descriptions
- Updated all documentation to include Venus A in the supported devices list
- Fix: validate and sanitize all `setSettings` input values (type coercion, numeric range clamping, IP whitespace trim) to prevent security issues

### 0.1.12 (2026-04-12)
- new release

> Older changelog entries are available in [CHANGELOG_OLD.md](./CHANGELOG_OLD.md)

## Support

For support, visit the ioBroker forum or GitHub repository. When reporting issues, please include:
- Adapter version
- Device model
- Firmware version
- Network configuration
- Detailed error messages