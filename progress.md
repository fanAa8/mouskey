# Progress Log

## Session: 2026-09-03 (Preset-First Refactor)

### Phase 5: Preset-First Architecture & Native Writing
- **Status:** complete
- **Core change:** Refactored the entire product from "read-first" to "preset-first". User's own MOBA/FPS/RPG scheme is now the authoritative source; reading game current keybindings is optional and never blocks change-set generation.
- Actions taken:
  - Created `src/adapters/` module with clean separation: types.ts, games.ts, patchGenerator.ts, formatters.ts, index.ts.
  - Moved all game definitions (native field names, defaults, canWrite flags) out of App.tsx into games.ts.
  - Implemented `generatePatchSet()` — pure function that derives changes from user profile vs game defaults, no filesystem access needed.
  - Implemented native config formatters for all 4 games: CS2 (Source bind commands), CF (KeySettings.ini), 饥荒 (settings.ini [controls]), LoL (Input.ini [GameEvents]).
  - Refactored App.tsx: removed LoL read-blocking logic (`if (isLol && !hasLolBindings)` guards deleted), change sets now always generate from user preset.
  - Added native config text preview panel with export-to-file button.
  - Added "写入能力" indicator (支持自动写入 / 暂不支持自动写入) per game.
  - LoL now shows yellow warning box explaining Tencent/WeGame version has no verified local keybind file; user can still preview and export.
  - Default game changed from 'lol' to 'cs2' (a writable game).
  - Backend: added `/api/adapters/detect` endpoint (Steam registry detection, CS2 userdata scan, CF/饥荒 path detection).
  - Backend: added `/api/adapters/write` endpoint with automatic timestamped backup to `keyforge_backups/` directory.
  - CS2 writer auto-detects autoexec.cfg and appends `exec keyforge.cfg` (with backup).
  - Write success automatically creates a restore point record.
  - Fixed ESM import issue (replaced `require('node:fs')` with top-level `readdirSync` import).
  - Fixed duplicate "Movement" comment in CS2 formatter.
- Files created:
  - src/adapters/types.ts
  - src/adapters/games.ts
  - src/adapters/patchGenerator.ts
  - src/adapters/formatters.ts
  - src/adapters/index.ts
- Files modified:
  - src/App.tsx (full refactor)
  - src/styles.css (new adapter panel styles)
  - vite.config.ts (new detect/write endpoints, preserved LoL read/watch)
  - HANDOFF.md (updated for refactored state)
- Verification:
  - `npm run build` passes (tsc + vite build, 752ms).
  - Browser test: page loads with 0 console errors.
  - CS2 selected by default: shows "支持自动写入", 6/14 changed items, proper bind format in native config preview.
  - Generate change set: shows full keyforge.cfg text with proper Source bind syntax, toast confirms.
  - Switch to LoL: shows "暂不支持自动写入" with detailed warning, change set still generates (7/14 items) from user preset, Input.ini preview shows proper format, button changes to "导出配置文件".
  - LoL "读取本机设置（可选）" and "监测保存位置" buttons preserved as optional enhancements.

## Session: 2026-09-02

### Product Direction Update (2026-09-03)
- **Status:** documented
- The product model is now preset-first: the user's MOBA/FPS/lightweight/RPG scheme is authoritative, and existing game settings are optional input for comparison or detection.
- Added `HANDOFF.md` with the current goal, implementation status, absolute file paths, verified LoL findings, run commands, and next-stage adapter work for transfer to another AI.

### Phase 1 (Revision): Native League of Legends Read Path
- **Status:** complete
- Actions taken:
  - Confirmed the current product model must be revised to read installed control settings before mapping actions.
  - Located the local Riot client configuration directory.
  - Identified that the discovered files are client-level configuration, not confirmed in-game input settings.
  - Logged and stopped an overly broad configuration keyword scan; switching to targeted discovery.
  - Validated the LoL native persistence manifest: Game.cfg and Input.ini are the source files and contain persisted WASD mode data.
  - Identified C: and D: as available fixed drives; an initial root-directory query had a parse error before scanning.
  - Found Riot ProgramData installation metadata including League of Legends live and PBE product records.
  - Resolved the WeGame LeagueClient installation directory and confirmed its top-level configuration directory only contains client preference YAML files.
  - Established that the Tencent package's game data is under LeagueClient/DATA/CFG and moved inspection there after candidate filename discovery returned no matches.
  - Confirmed DATA/CFG has no direct files and contains a defaults directory; proceeding to inspect its bounded contents rather than treating it as an active user config.
  - Read the packaged LoL persistence manifest and established that Game.cfg and Input.ini are the native user-control files, with persisted WASD settings in Game.cfg.
- Files created/modified:
  - task_plan.md
  - findings.md
  - progress.md

### Phase 3 (Revision): Native LoL Reader
- **Status:** complete
- Actions planned:
  - Add a local-only reader endpoint for the resolved Riot installation paths.
  - Update the LoL workbench to display actual readings or an explicit no-file state.
- Actions completed:
  - Added a Vite local-only endpoint that parses Game.cfg and Input.ini when present.
  - Replaced the LoL mock adapter with read-first, missing-file, and loaded-state UI behavior.
  - Restarted the local server and verified the endpoint returns the actual missing-file state for this computer.
  - Started this project's dedicated development server on port 4174 because port 4173 was owned by another local project.
  - Confirmed the endpoint returns four League-only candidates, no existing Game.cfg/Input.ini, and the accurate not_found message.
  - Clicked the in-app read command in a real browser; the interface shows the real missing-file message and leaves the LoL change-set command disabled.
  - Player then launched League and saved settings, but the endpoint continued to return not_found for all four original candidates; beginning a bounded discovery extension for the Tencent/WeGame layout.
  - Confirmed the active Tencent LeagueClient root has no Game subdirectory and a complete filename search of that root plus normal League user directories still finds no native files.
  - Found that the recent save updated client YAML preference files only; began checking Tencent/WeGame user data and the Tencent LOL registry branch for the actual in-game keybind location.
  - Confirmed the Tencent LOL registry branch stores only the install path, while bounded WeGame/TGP user-data searches yielded no in-game keybind files.
  - Verified the recently written LeagueClientSettings.yaml has no hotkey-related fields while the packaged manifest continues to require Game.cfg/Input.ini; preparing a targeted write-event monitor for the next in-game binding save.
  - Started a 30-minute monitor for writes under the League installation, Documents, the local Riot folder, and Tencent WeGame/TGP user-data folders. It records only relevant file paths and timestamps, waiting for a saved hotkey change from an actual game session.
  - The monitor itself had no event, but diagnosis found the actual Windows Documents known folder is redirected to D:\\Users\\Downloads\\Programs\\Documents, which contains League of Legends. The original adapter missed it by using USERPROFILE\\Documents on C:.
  - Updated discovery to resolve the Windows registered Documents path, rather than assuming USERPROFILE\\Documents.
  - Added an in-app local save-location monitor with start/status endpoints and a Native Adapter control. It watches only known LoL, WeGame, and corrected Documents locations. The service reports watching state with no events yet.
  - Verified the updated production build and started the monitor through the local API; it watches five concrete local roots and is awaiting a second in-game keybind save.
  - Captured the second in-game save: 63 events all target LeagueClientSettings.yaml, with no Game.cfg/Input.ini or alternative candidate file. The reader correctly remains not_found; do not parse the YAML as a keyboard profile.
  - Aggregated the completed monitor: all 63 relevant events point to LeagueClientSettings.yaml. Registry inspection found no Tencent LoL hotkey source; DirectInput entries only expose standard mapper values. Native write-back remains intentionally disabled because no verified local keybind store exists for this installed Tencent client.

### Phase 1: Scope and Product Model
- **Status:** complete
- Actions taken:
  - Captured the native configuration and cross-game action-profile requirements.
  - Verified that the supplied workspace has no existing project files.
  - Chose a local-first interactive prototype as the first implementation.
  - Confirmed Node.js 22.19.0 and npm 10.9.3 are available.
- Files created/modified:
  - task_plan.md
  - findings.md
  - progress.md

### Phase 2: Application Structure and Design
- **Status:** complete
- Actions taken:
  - Decided on a React, TypeScript, and Vite application with interactive local state.
  - Implemented the full application shell, profile model, action mapping, keyboard and mouse visualizations, game rules, change preview, and recovery-point interactions.
- Files created/modified:
  - task_plan.md
  - findings.md
  - progress.md
  - package.json
  - package-lock.json
  - index.html
  - tsconfig.json
  - vite.config.ts
  - src/main.tsx
  - src/App.tsx
  - src/styles.css
  - src/vite-env.d.ts

### Phase 3: Interactive Implementation
- **Status:** complete
- Actions taken:
  - Implemented reusable profile switching and profile cloning.
  - Added safe key reassignment with existing bindings swapped rather than duplicated.
  - Added native rule previews for 英雄联盟, CS2, 穿越火线, and 饥荒.
  - Added local restore-point creation and action feedback.
- Files created/modified:
  - src/App.tsx
  - src/styles.css

### Phase 4: Verification
- **Status:** complete
- Actions taken:
  - Production build completed successfully after adding Vite's CSS type declaration.
  - Started a local development server on port 4173.
  - Opened the application in a real browser and captured the accessible UI structure.
  - Diagnosed the one console error as a missing favicon request and added an inline favicon reference.
  - Captured a full-page screenshot at the initial viewport. It has no visible overlaps, but it uses the intermediate responsive layout rather than the intended wide desktop composition.
  - Resized the browser to 1440 by 1000 and captured a wide-desktop screenshot for visual inspection.
  - Confirmed the browser is using 1.25 device scale, so the 1440-pixel viewport is a 1152-CSS-pixel intermediate responsive layout.
  - Received user feedback that the keyboard should use normal continuous rows and take the main right-hand workspace, rather than being compressed by a three-column layout.
  - Rebuilt the workspace as a two-column layout with the native-adapter panel under the keyboard.
  - Replaced fixed keyboard grid columns with flexible physical-key widths and captured a 1920-pixel verification screenshot.
  - Verified that the corrected desktop page has no horizontal overflow and that the right-hand keyboard workspace is 873 CSS pixels wide.
  - Confirmed the keyboard's internal width matches its viewport and the mouse map remains inside the input-stage bounds.
  - Verified a key reassignment swaps conflicting bindings instead of duplicating them.
  - Verified game selection updates the adapter name, destination path, native field names, and change-set command.
  - Reset the interactive state and moved the real browser to a 500-pixel mobile viewport for the final layout check.
  - Captured the mobile layout and found that the keyboard's minimum width widened the full page instead of staying within an internal scroll area.
  - Applied the mobile containment correction and rebuilt successfully.
  - Reopened the local application after the blank-tab reset and set it back to the 500-pixel mobile viewport.
  - Verified the mobile page keeps its viewport width while the keyboard alone has a contained horizontal scroll area; captured the corrected mobile screenshot.
  - Checked the final browser console: zero errors and zero warnings.
  - Captured the post-reader visual state: the genuine no-file warning sits in the native-settings area, the change-set button is visibly disabled, and no text is overlapped or clipped.
  - Completed the refreshed production build after native-reader integration and checked the browser console: both passed with no warnings or errors.
- Files created/modified:
  - dist/ (generated production build)
  - index.html

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Workspace inspection | File inventory | Determine whether an existing app exists | No project files found | Pass |
| Production build | npm run build | Type check and create production bundle | Production bundle built successfully | Pass |
| Desktop browser structure | Real browser snapshot | All principal controls are present and actionable | All principal controls exposed with accessible names | Pass |
| Initial visual capture | Full-page browser screenshot | Readable responsive layout | No text overlap; intermediate breakpoint needs follow-up review | Pass with follow-up |
| Keyboard layout correction | npm run build | Type check and create production bundle after layout changes | Production bundle built successfully | Pass |
| Binding swap | Select Skill 1 then assign W | Skill 1 takes W and Forward receives Q | Snapshot shows the expected swapped keys and updated native preview | Pass |
| Game adapter switch | Select CS2 | Native rule preview updates to CS2's adapter fields | Source rule package, destination path, and command updated | Pass |
| Initial mobile visual capture | 500-pixel real browser viewport | No page-level horizontal overflow | Keyboard minimum width clips right-side content | Needs fix |
| Corrected mobile containment | 500-pixel real browser viewport | Page remains viewport width and only keyboard scrolls | 501px document (scrollbar) with 443px keyboard viewport / 530px internal keyboard | Pass |
| Final browser console | Real browser console | No app errors or warnings | 0 errors, 0 warnings | Pass |
| Native LoL reader | Dedicated local server on port 4174 | Discover actual settings or report their absence | Four LoL-only candidates; no Game.cfg/Input.ini found; accurate not_found state returned | Pass |
| Native LoL reader UI | Click "读取本机设置" | Display real missing-file state and prevent change set | Missing-file message displayed; "生成 英雄联盟 变更集" remains disabled | Pass |
| Final production build | npm run build | Type-check and build after reader integration | Built successfully in 394 ms | Pass |
| Final browser console | LoL reader state | No client errors or warnings | 0 errors, 0 warnings | Pass |
| Corrected Documents discovery | Windows known-folder registry value | Use the actual Documents location | Candidate now resolves to D:\\Users\\Downloads\\Programs\\Documents\\League of Legends\\Config | Pass |
| Native save monitor | Local watch start/status endpoints | Monitor known write locations without reading contents | Watching five concrete local roots; no event before the next save | Pass |
| Production build after monitor | npm run build | Type-check and build monitor integration | Built successfully in 601 ms | Pass |
| Second in-game keybind save | Native save monitor + reader | Capture the actual local configuration file | 63 events for client YAML only; no readable keyboard file; write-back stays disabled | Pass (negative finding) |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-09-02 | TypeScript TS2882 for styles.css side-effect import | 1 | Added Vite client type declaration; rerun passed. |
| 2026-09-02 | Image-preview helper variable shadowed its output function | 1 | Retried with a distinct variable name; screenshot rendered successfully. |
| 2026-09-02 | Playwright reload operated on an about:blank tab | 1 | Confirmed the local tab was no longer present; open a new local-app tab for validation. |
| 2026-09-02 | Full ClientConfiguration.json keyword scan | 1 | Abandoned the broad scan and switched to exact install-path and filename discovery. |
| 2026-09-02 | Root directory discovery script pipeline parse error | 1 | Collect output in a variable before formatting it. |
| 2026-09-02 | Initial dedicated-server launch used one file for both output streams | 1 | Restarted with separate standard-output and error logs; Keyforge is available on port 4174. |
| 2026-09-02 | Git status/diff check | 1 | Workspace is not a Git repository, so no repository diff is available; verification relies on direct build and browser checks. |
| 2026-09-02 | Restarting Vite via a new background process | 1-2 | System policy blocked the process-launch command; Vite automatically restarted after vite.config.ts changed, so use the existing service. |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 1: scope and product model. |
| Where am I going? | Build the prototype, verify it, and deliver a local URL. |
| What's the goal? | A native-settings control-profile prototype. |
| What have I learned? | See findings.md. |
| What have I done? | Created the persistent plan and documented the starting scope. |
## 2026-09-04 - LoL cloud write correction and mode validation

- Restored League of Legends as a write-capable adapter because the intended path is the running client LCU API and account/cloud sync, not a guessed Tencent local file.
- Changed `/api/adapters/write` to try LCU first for LoL, then fall back to verified local `PersistedSettings.json`/`input.ini` writing when available.
- Added `modeId` to write requests and patch sets so traditional and WASD profiles select the correct native section.
- Added LoL WASD section formatting and filtering. The WASD preview now contains only verified events such as `MoveUp`, `CastSpell1`, `UseVisionItem`, and `CancelCurrentActions`.
- Corrected traditional LoL event names from the observed local file (`evtCastAvatarSpell*`, `evtUseVisionItem`, `evtCastRoleBound`, `evtShowScoreBoard`) and removed unsupported recall/cancel/confirm mappings from the traditional allow-list.
- Added a write confirmation prompt and updated safety copy to distinguish cloud sync from local backup.
- Verification: `npm run build` passed; `npm run lint` passed with warnings only; browser preview showed 17 WASD patches and a `[WASD]` native section; read-only LCU GET returned HTTP 200 with 6343 bytes.
