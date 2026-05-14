# Changelog (Older Versions)

All changelog entries prior to the current version are stored here.

---

### 0.1.12 (2026-04-12)
- new release

### 0.1.11 (2026-04-12)
- Fixed incorrect retry counter in error messages: now correctly shows actual number of attempts instead of configured maxRetries
- Updated default configuration values
    - maxRetries: 3
    - requestTimeout: 3000ms
    - pollInterval: 20000ms
    - fastPollInterval: 5000ms
- Added 7 day cooldown to dependabot configuration
- Split changelog into README.md (current) and CHANGELOG_OLD.md (historical entries)
- Updated all documentation with new default values
- 
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
## 0.1.14 (2026-04-14)
- Fixed: VenusE/VenusC devices failing polls with "Method not found" errors by skipping PV polling for models that don't support PV component (per API documentation, only Venus D/A have PV support)
- refactor: replace `setStateAsync` with `setState` across codebase for consistency
- chore: adjust polling and timeout configuration ranges in jsonConfig
- docs: expand README with detailed device support matrix, API component compatibility table, firmware details, and new warnings for Venus E 2.0 connectivity

## 0.1.12 (2026-04-12)
- new release

> Older changelog entries are available in [CHANGELOG_OLD.md](./CHANGELOG_OLD.md)
