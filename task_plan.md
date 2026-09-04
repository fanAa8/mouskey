# Task Plan: Keyforge Personal Control Profiles

## Goal
Create a polished local-first Windows tool that lets a player maintain personal genre-based control profiles, visualize them on a keyboard and mouse, and generate safe native configuration changes for supported games. Reading an existing game's controls is optional, not a prerequisite.

## Current Phase
Phase 3: native profile application model

## Phases

### Phase 1: Scope and Product Model
- [x] Capture the user's local-native configuration requirement.
- [x] Define a canonical action profile rather than raw file copying.
- [x] Confirm the starter project environment.
- [x] Locate the installed League of Legends game configuration and validate its input schema.
- **Status:** complete

### Phase 2: Application Structure and Design
- [x] Create the desktop-inspired application shell.
- [x] Define local data models for profiles, game adapters, and restore points.
- [x] Design responsive keyboard and mouse visualizations.
- **Status:** complete

### Phase 3: Interactive Implementation
- [x] Build profile editing and action selection.
- [x] Build game selection, native mapping preview, and staged apply flow.
- [x] Build local restore-point/history interactions.
- [x] Add a local LoL reader endpoint that discovers and parses Game.cfg and Input.ini.
- [x] Replace LoL's mocked bindings with explicit read, missing-file, and loaded states.
- [x] Extend LoL discovery to the Windows registered Documents path.
- [x] Capture the in-game save behavior with a bounded local write-event monitor.
- [x] Confirm the observed Tencent/WeGame client has no verified local keybind store in the checked locations.
- [ ] Make preset-to-native application the primary flow; reading current settings remains optional.
- [x] Add a write-capable adapter contract with backup, diff, confirmation, and restore stages.
- [x] Route LoL writes through LCU cloud sync before optional verified local-file fallback.
- [x] Add mode-specific native fields and supported-action filtering for LoL WASD.
- **Status:** in_progress

### Phase 4: Verification
- [x] Run build checks.
- [x] Inspect desktop and mobile layouts in a real browser.
- [x] Fix the keyboard's layout and adjust the desktop information hierarchy based on user feedback.
- [x] Verify the native reader's missing-file state against this computer's actual install.
- **Status:** complete

### Phase 5: Delivery
- [x] Record final verification results.
- [x] Start the development server and provide the local URL.
- [x] Refresh final visual and build verification after native-reader integration.
- [ ] Re-verify after extending LoL discovery.
- [x] Re-verify LoL discovery and LCU connectivity after restoring cloud writes.
- **Status:** in_progress

## Key Questions
1. How can a shared player preference remain meaningful across games with different control schemes? Answer: use canonical actions plus per-game native adapters.
2. What must remain outside the prototype's scope? Input injection, running-process changes, cloud synchronization, and automated discovery of unknown game formats.

## Decisions Made
| Decision | Rationale |
|---|---|
| Local-first web prototype | Fast to validate the interaction model before packaging a Windows desktop app. |
| Canonical action profile | A player preference such as Forward or Ability 1 can be translated without copying incompatible files. |
| Native adapters only | The actual product writes game-owned configuration files after preview, rather than injecting inputs. |
| Starter adapters for LoL, CS/CF, and Don't Starve | They demonstrate different genres and provide a practical initial scope. |
| Two-column editing workspace | The keyboard needs the available horizontal space; the native-adapter section belongs beneath it, not as a third competing column. |
| Preset first, read optional | A player's own genre/profile scheme is the product's source of truth; reading an existing game is a comparison and discovery enhancement, not a gate. |
| LoL adapter safety | Parse Game.cfg/Input.ini only when verified files exist; for the observed Tencent/WeGame client, keep write-back disabled until a trustworthy native keybind source is identified. |

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| TypeScript could not resolve the CSS side-effect import | 1 | Add the standard Vite client type reference. |
| Keyboard rows wrap wide keys into blank lines | 1 | Replaced fixed 14-column CSS grid with rows of flex-width keys. |
| Mobile keyboard widens the page | 1 | Constrain the scrollable keyboard within its own visual panel and adjust compact row sizing. |
| Playwright session selected a blank tab after the mobile fix | 1 | Verified only the blank tab remained; open the local application in a new tab instead of retrying reload. |
| Client-configuration keyword search produced excessive output | 1 | Use the small Riot YAML install record and targeted file discovery rather than scanning the full client configuration. |
| Root-directory scan PowerShell syntax error | 1 | Collect the directory results before applying output formatting. |
