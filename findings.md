# Findings & Decisions

## Requirements
- A player maintains one familiar set of controls across many games.
- The player's preset is the source of truth. Current game controls may be read for comparison, but the user must be able to apply a preset even when no current binding file can be read.
- Presets should be organized by genre/use case: MOBA, FPS, lightweight games, RPG/survival, with small per-game differences handled by adapters.
- The interface must show a keyboard and mouse with action-to-input assignments.
- The product works through each game's local, native configuration data rather than runtime input mapping.
- It needs backup, preview, and restoration safety around configuration changes.
- The system must read an installed game's actual control configuration first; it cannot assume legacy game defaults such as LoL camera movement.

## Research Findings
- Mature backup tools can copy game configuration locations, but cross-game compatibility requires per-game translation because file formats and action names differ.
- A native adapter must know where a game's local configuration is stored and how to read and write its specific representation.
- The workspace is empty and has Node.js 22.19.0 with npm 10.9.3 available, so a self-contained Vite application can be created without adapting an existing codebase.
- This machine contains C:\Users\Administrator\AppData\Local\Riot Games\League of Legends\Config with RiotClientSettings.yaml and ClientConfiguration.json. Those are client-level files and do not yet establish the location of the in-game control settings.
- C:\ProgramData\Riot Games contains RiotClientInstalls.json and metadata for league_of_legends.live and league_of_legends.pbe, confirming that installer records are the correct next source for the actual game location.
- The install registry resolves a WeGame LeagueClient directory on D:. Its top-level Config directory exists but contains League Client preference YAML files, not confirmed in-game input settings. The game config must be found by targeted filename discovery under the resolved install path.
- The resolved Tencent/WeGame package does not use the international Game/Config layout. It has a DATA/CFG directory, while targeted candidate-name search under the install root did not find PersistedSettings, input.ini, game.cfg, or keybind-named files.
- DATA/CFG contains no direct files and has a defaults subdirectory, which suggests it is packaged default data rather than a player's active user-control file.
- The bundled SettingsToPersist.json establishes the real LoL persistence contract: active user settings belong in Game.cfg and Input.ini. It explicitly marks WASDMovementRotation and CameraModeWASD as persisted Game.cfg settings, so the adapter must derive WASD mode from observed values rather than assume legacy camera controls.
- The local reader endpoint is running and returns the real missing-file state on this machine. Riot's installation manifest also includes Legends of Runeterra, so LoL discovery filters its install roots by League/英雄联盟 identity before building configuration candidates.
- End-to-end verification on the dedicated Keyforge server confirms four LoL-only configuration candidates (two installed LeagueClient roots plus the normal Documents and LocalAppData paths). None contains Game.cfg or Input.ini on this computer, so the product correctly keeps LoL's change-set action disabled and displays the genuine missing-file notice.
- After the player launched the game and saved settings, the same four candidates still contain neither file. The current candidate model therefore misses the Tencent/WeGame user's active game-config location; investigate only under the resolved LeagueClient roots and standard League user directories, starting with a likely Game/Config subdirectory.
- The active client process resolves to D:\\wegameapps\\英雄联盟\\LeagueClient, whose direct folders do not include Game. A bounded filename search across that complete LeagueClient root and the standard League user roots still found no Game.cfg, Input.ini, or PersistedSettings.json. The next discovery scope is Tencent/WeGame user-data directories and recent configuration-file modifications, not the entire disk.
- After launch/save, the files actually updated under LeagueClient/Config are LeagueClientSettings.yaml, LCUAccountPreferences.yaml, PerksPreferences.yaml, LCULocalPreferences.yaml, and TFTPreferences.yaml. These are client preferences rather than a demonstrated in-game keybind store. The Windows user profile has Tencent WeGame/TGP data and an HKCU\\Software\\Tencent\\LOL registry branch, both now in the bounded discovery scope.
- HKCU\\Software\\Tencent\\LOL contains only the game install path. The bounded Tencent WeGame/TGP user-data search found launcher/library/cloud-game files but no keybind data or native Game.cfg/Input.ini. The saved settings have not yet been proven to be an in-game hotkey save, so validate the updated YAML for hotkey fields and, if absent, capture the next write event instead of expanding filesystem scans.
- LeagueClientSettings.yaml contains no key, hotkey, binding, input, WASD, control, or shortcut field names. The packaged SettingsToPersist manifest still specifically identifies Game.cfg and Input.ini (including persisted WASDMovementRotation and CameraModeWASD). Do not treat the YAML files as keyboard configuration. A write-event monitor is now the appropriate targeted diagnostic.
- Root cause found: Windows redirects the current user's Documents known folder to D:\\Users\\Downloads\\Programs\\Documents, while the initial adapter incorrectly used USERPROFILE\\Documents on C:. The redirected directory contains a League of Legends folder. Inspect that exact folder, then change discovery to use the Windows known-folder path rather than a concatenated user-profile path.
- The adapter now derives the Documents candidate from Windows' registered known-folder value, and the Vite server automatically restarted with that change. The native save monitor is now part of the local service, watches the corrected D:\\Users\\Downloads\\Programs\\Documents\\League of Legends directory plus known LoL/WeGame paths, and records only future relevant file paths and timestamps. It is running and awaiting a second explicit in-game hotkey save.
- The second monitored save produced 63 write/rename events, all for D:\\WeGameApps\\英雄联盟\\LeagueClient\\Config\\LeagueClientSettings.yaml. No other relevant file appeared, and the reader still finds no Game.cfg/Input.ini. Because the YAML has no hotkey-related fields, it must not be treated as a local keyboard configuration source. Investigate a Tencent-specific registry or server-synchronized settings layer next.
- A second local-registry inspection found no Tencent LoL keybind or Input.ini/WASD registry source. The only related DirectInput keys contain standard Name/UsesMapper values, not bindings. The observed Tencent client therefore does not expose a verified local native keybind store in its installation, registered Documents folder, known Riot/WeGame data roots, or related registry keys. Keep native write-back disabled for this adapter until a verifiable source is available.

## Technical Decisions

## Latest LoL Write Decision
- The user clarified that LoL synchronization is the primary value, so LoL remains write-capable through the running client LCU API and cloud sync.
- The verified Tencent/WeGame client exposes `PersistedSettings.json` and `input.ini` under `D:\WeGameApps\英雄联盟\Game\Config` on this machine; these are used for local backup/fallback when present, but client preference YAML is never treated as keybind data.
- LCU writes are attempted first and do not require a local input file. Traditional and WASD writes target separate sections (`GameEvents` and `WASD`) and use observed native event names.
- Browser validation confirmed the WASD preview contains 17 supported native events only, including `MoveUp`, `MoveLeft`, `MoveDown`, `MoveRight`, `CastSpell1-4`, `UseVisionItem`, and `CancelCurrentActions`.
- Read-only LCU connectivity check on 2026-09-04 returned HTTP 200 from `/lol-game-settings/v1/input-settings` with a 6343-byte response.
| Decision | Rationale |
|---|---|
| React + Vite + TypeScript | A compact, maintainable way to prototype the interactive product. |
| Static demo adapters | The UI can exercise the full mapping and preview model without claiming to edit a real installed game. |
| Action categories | Movement, combat, abilities, utilities, and inventory make the profile easy to scan. |
| Vite local middleware for LoL reads | It provides actual filesystem access during local development without granting a browser unrestricted file access. |
| Preset-first application flow | The user's own genre/profile scheme is authoritative; native reads are optional discovery, not a prerequisite. |
| Native writes behind adapters | Automatic changes are allowed only when a game-specific format and target path are verified, with backup and preview before confirmation. |

## Issues Encountered
| Issue | Resolution |
|---|---|
| Empty workspace | Scaffold a new application deliberately rather than modifying unknown code. |
| CSS side-effect import missing a declaration in TypeScript | Add src/vite-env.d.ts with Vite's standard client reference. |
| Broad ClientConfiguration.json keyword scan generated excessive output | Use targeted discovery through the Riot install YAML and likely game config filenames. |
| Initial root-directory scan had a PowerShell pipeline parse error | Retry with results collected into an array before formatting; no scan ran. |

## Resources
- https://github.com/mtkennerly/ludusavi
- https://github.com/dyang886/Game-Save-Manager

## Visual/Browser Findings
- Desktop browser accessibility snapshot exposes all core interactions: profile switching, category filters, individual action rows, keyboard keys, mouse buttons, target-game selector, preview toggle, restore points, and change-set generation.
- The initial browser console error was only a missing favicon request. An inline favicon reference removes it without changing application behavior.
- The first full-page screenshot used a narrow desktop viewport. It showed no overlapping text, but the intermediate breakpoint moved the native adapter below the keyboard and needs a dedicated wide-desktop and mobile check before acceptance.
- The headed browser is at a 1.25 device scale. A physical 1440-pixel viewport yields 1152 CSS pixels and intentionally enters the intermediate two-column layout; no horizontal overflow was observed.
- User visual review found an important usability issue: the previous three-column desktop layout constrained the keyboard, and the fixed 14-column keyboard grid wrapped wide physical keys such as Backspace onto separate lines. The correction is a two-column workspace with a flexible, real-key-width keyboard row model.
- After correction at a 1536-CSS-pixel desktop viewport, document width equals viewport width (no horizontal overflow) and the keyboard workspace is 873 CSS pixels wide.
- The continuous keyboard rows have no internal scroll width beyond their visible width. The mouse map sits within the right-hand input stage, so its absence from a resized artifact preview is not a page-layout overflow.
- Interaction verification passed: selecting Skill 1 then choosing W swaps Skill 1 from Q to W and Forward from W to Q, preserving one unique owner per input. Selecting CS2 swaps the native preview to Source names and its target path.
- The first mobile screenshot exposed a narrow-screen defect: the keyboard's minimum width leaked into the page width, clipping controls on the right. It needs to scroll inside its own viewport instead of widening the document.
- After the mobile correction, the 500-pixel viewport has a 501-pixel document width (the normal 1-pixel scrollbar difference), while the keyboard wrapper is 443 pixels wide with a 530-pixel internal scroll area. The page is no longer widened by the keyboard.
