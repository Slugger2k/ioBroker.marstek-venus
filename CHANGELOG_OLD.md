# Changelog (Older Versions)

All changelog entries prior to the current version are stored here.

---

### 0.1.10 (2026-04-12)
- fix adapter checker issues
- dependebot updates
- "Fix author field in package.json from object to string
- Remove empty supportedMessages from io-package.json
- Remove duplicate channel creation from initStates()
- Remove redundant Object.assign prototype inheritance
- Pass adapter instance to _requestQueue.clear() on unload
- Fix control.mode role from switch.mode to value
- Fix power.pvVoltage and power.pvCurrent roles to value.voltage/value.current
- Fix energymeter.ctState role and add states map
- Fix network.rssi role from value.signal to value
- Fix info.firmware role from value to text
- Add loglevel and readme fields to io-package.json common
- Add enabled: false to io-package.json common
- Fix setSettings: use extendForeignObjectAsync with dynamic namespace
- Fix info.connection role: use indicator.reachable for device connection state"

### 0.1.9 (2026-04-12)
- fix adapter checker issues

### 0.1.6 (2026-04-12)
- Removed invalid ES.GetInfo call which was causing Method not found errors
- Device information is now obtained exclusively during discovery

### 0.1.5 (2026-04-11)
- Initial release with full Marstek Venus Open API support
