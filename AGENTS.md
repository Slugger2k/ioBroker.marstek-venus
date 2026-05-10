# AGENTS.md

> **For Agentic Coding Assistants**
> This file contains all rules, commands, conventions and guidelines for working in this repository.
> Follow these instructions strictly when modifying code, running tests, or making changes.

---

## PROJECT OVERVIEW

This is **iobroker.marstek-venus** - an ioBroker adapter for Marstek Venus A/C/D/E energy storage devices.

- **Type**: ioBroker Adapter
- **Language**: Plain JavaScript (Node.js)
- **Runtime**: Node.js >= 20.0.0, ioBroker js-controller >=5.0.0
- **Protocol**: UDP socket communication
- **Main entry**: `main.js`
- **No transpilation, no TypeScript, no build step required**

### API Documentation

The Marstek Device Open API documentation is located at `MarstekDeviceOpenApi.md` in the project root.

---

## COMMANDS

### Testing
Always run tests before committing changes.

| Command | Purpose |
|---------|---------|
| `npm run test` | Run all tests (package + unit) |
| `npm run test:package` | Run only package validation tests |
| `npm run test:unit` | Run only unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run coverage` | Run full test suite with coverage |
| `npm run coverage:report` | Generate coverage reports |

> **Running single test file:**
> ```bash
> npx mocha test/unit.test.js --exit
> ```

### Linting
This project uses ESLint with `@iobroker/eslint-config`. Configuration is in `eslint.config.mjs`.

| Command | Purpose |
|---------|---------|
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |

### i18n Translation
| Command | Purpose |
|---------|---------|
| `npm run translate` | Run the translate-adapter tool |

### Admin-UI
- Use **JSONConfig** (`admin/jsonConfig.json`) for the admin UI
- Set `translate: false` in the JSONConfig if translation is not desired

---

## CODE STYLE GUIDELINES

### General Formatting
1. **Indentation**: 4 spaces, NO tabs
2. **Quotes**: Single quotes `'` for all strings. Use backticks `` ` `` **only** for template literals.
3. **Line endings**: Unix LF (not CRLF)
4. **Line length**: Maximum 120 characters
5. **Strict mode**: Always include `'use strict';` at the very top of every file
6. **Semicolons**: Always required at end of statements
7. **Trailing commas**: Do not use trailing commas in objects/arrays
8. **Brace style**: Same line opening braces (Allman style not used)

### Imports
1. Use only CommonJS `require()` syntax. **NO ES Module `import` syntax.**
2. Node.js builtins must use `node:` prefix:
   ```js
   const dgram = require('node:dgram'); // Correct
   const dgram = require('dgram');     // Incorrect
   ```
3. Order of imports:
   - Node.js builtins first
   - External npm dependencies next
   - Local project files last
4. One require per line, all imports at the top of the file
5. Do not use destructuring on require statements unless necessary

### Naming Conventions
| Item | Convention | Example |
|------|------------|---------|
| Classes / Constructors | PascalCase | `MarstekVenusAdapter` |
| Methods / Functions | camelCase | `onReady`, `handleResponse` |
| Variables / Parameters | camelCase | `requestId`, `pendingRequests` |
| Private class members | Prefix with underscore `_` | `_pollingInterval`, `_socket` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_POLL_INTERVAL` |
| Files | kebab-case lowercase | `adapter-config.js` |

> **Do NOT use**:
> - Hungarian notation
> - Abbreviations unless universally understood
> - Single letter variable names except for loops

### Error Handling
**Strict rules for error handling:**
1. **Always use try/catch** around every async/await call
2. **Never throw unhandled errors**. All errors must be caught and logged
3. Use the adapter log hierarchy:
   ```js
   this.log.error('Critical failure', err);    // Fatal errors
   this.log.warn('Non critical issue', err);   // Warnings
   this.log.info('Operation completed');       // Normal events
   this.log.debug('Detailed state data');      // Debug info
   ```
4. Always include the original error object in log calls
5. **Never crash the adapter**. Always implement graceful degradation
6. Clean up resources (sockets, timeouts) on error
7. Do not use `console.log()` or `console.error()` - use only adapter log methods

### Asynchronous Code
1. Use **async/await exclusively** for all async operations
2. **Do not use callbacks** or raw promises unless required by external APIs
3. Always handle promise rejections
4. Do not use async IIFEs at file level
5. Set reasonable timeouts on all network operations

### Class Patterns
1. All adapter logic is implemented in a class extending `utils.Adapter`
2. Bind event handler methods properly with `.bind(this)`
3. Clean up all timers, listeners and sockets in `onUnload()`
4. Use private `_` prefixed members for internal state
5. Keep methods focused and single purpose

---

## TESTING GUIDELINES
- Test runner: Mocha
- Coverage: nyc (Istanbul)
- Tests are located in `/test/` directory
- All new functionality must have corresponding tests
- Do not modify test files unless you are fixing or improving the tests
- Always run `npm run test` before submitting changes
- Coverage reports are generated in `/coverage/` directory

---

## COMMIT RULES
1. **Never commit**:
   - `node_modules/`
   - `coverage/`
   - IDE files (.idea, .vscode)
   - Secrets or credentials
   - Log files
2. Commit messages should be descriptive and explain what changed
3. One commit per logical change
4. Run all tests before committing

---

## AGENT BEHAVIOR RULES

### When editing code:
1. **Mimic existing code exactly**. Copy indentation, spacing, brace style, naming conventions perfectly
2. Do not introduce new libraries or dependencies unless explicitly requested
3. Do not refactor existing working code unless there is a bug
4. Do not add comments unless necessary to explain non-obvious logic
5. Do not change code style of existing working code
6. Preserve all existing functionality unless you are fixing a bug
7. Always test your changes before declaring the task complete
8. Always adding changelog to README.md file section ## Changelog\n### **WORK IN PROGRESS**

### When asked to implement something:
1. First check how similar functionality is implemented elsewhere
2. Follow the same patterns and approach already used
3. Use the same error handling and logging conventions
4. Write tests that follow the same patterns as existing tests
5. Run the tests to verify your changes work

---

## IMPORTANT NOTES FOR IOBROKER ADAPTERS

This adapter runs inside the ioBroker runtime. All ioBroker adapter API rules apply:

| Topic | Common AI Mistake | Correct Approach |
|-------|-------------------|------------------|
| Admin-UI | Generates `admin/index_m.html` (Admin2) | Use **JSONConfig** (`jsonConfig.json5`) |
| Roles | Sets `role: "state"` everywhere | Use correct [State Roles](https://github.com/ioBroker/ioBroker/blob/master/doc/STATE_ROLES.md) |
| Objects | Creates states under states | Follow `device` → `channel` → `state` hierarchy |
| Timers | Uses Node.js `setTimeout`/`setInterval` | Use `adapter.setTimeout`/`adapter.setInterval` |
| Process Exit | Uses `process.exit()` | Use `adapter.terminate()` |
| Passwords | Stores passwords in plain text | Use `encryptedNative` + `protectedNative` |
| setObject | Overwrites existing objects | Use `setObjectNotExists` or `extendObject` |
| ack flag | Ignores `ack` completely | Use `ack=true` for final values, `ack=false` for commands |
| Language | Creates German README.md / logging | README.md must be in English, logs must be English |
| Object IDs | No filtering | Object IDs must only contain A-Za-z0-9-_ |
| Intermediate objects | Missing intermediate objects | All objects in tree must be created explicitly |
| Testing | No standard testing | Use test-and-release.yml workflow |

---

## CHECKLIST BEFORE SUBMITTING

Before submitting the adapter to the repository, **must** have:

- [ ] Adapter Creator used (not copied from hand)
- [ ] Adapter Checker passed: https://adapter-check.iobroker.in/
- [ ] GitHub-Repo named `ioBroker.<adaptername>` (capital B)
- [ ] package.json name is lowercase (`iobroker.<adaptername>`)
- [ ] README.md in English with description + link to device/manufacturer
- [ ] License in io-package.json, README.md AND as LICENSE file
- [ ] GitHub Actions for adapter testing (Package + Integration Tests)
- [ ] io-package.json: `type`, `connectionType`, `dataSource`, `authors` set
- [ ] State Roles correct (not just `"state"` everywhere)
- [ ] Unload cleans up ALL resources (Timers, Connections, Ports)
- [ ] Compact Mode tested (Start → Run → Stop → Restart)
- [ ] `info.connection` state implemented (for external connections)
- [ ] Unused directories (`www`, `widgets`, `docs`) removed
- [ ] Port attribute named `port`, IP attribute named `ip`

---

**TL;DR:** Use official tools → Write code → Run tests → Adapter Checker → Fix → Submit.
