/**
 * Parse Ludusavi manifest.yaml and generate a compact JSON lookup table
 * for Keyforge. Only includes games with Steam AppID and config-tagged files.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MANIFEST_PATH = path.join(__dirname, '..', 'work', 'ludusavi-manifest.yaml');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'ludusavi-games.json');

// Ludusavi path placeholders -> Windows environment variable resolution
// These are resolved at runtime in vite.config.ts, here we just keep the placeholder
const PLACEHOLDERS = {
  '<winDocuments>': '%USERPROFILE%\\Documents',
  '<winLocalAppData>': '%LOCALAPPDATA%',
  '<winAppData>': '%APPDATA%',
  '<winSavedGames>': '%USERPROFILE%\\Saved Games',
  '<home>': '%USERPROFILE%',
  '<root>': '<gameRoot>',
  '<base>': '<gameRoot>',
  '<storeUserId>': '<storeUserId>',
  '<osUserName>': '%USERNAME%',
};

function resolvePlaceholder(p) {
  for (const [ph, replacement] of Object.entries(PLACEHOLDERS)) {
    if (p.includes(ph)) {
      p = p.replace(ph, replacement);
    }
  }
  return p;
}

function hasConfigTag(tags) {
  if (!Array.isArray(tags)) return false;
  return tags.includes('config');
}

function isWindowsPath(whenConditions) {
  if (!Array.isArray(whenConditions)) return true; // no condition = all platforms
  return whenConditions.some(w => w.os === 'windows' || !w.os);
}

console.log('Parsing Ludusavi manifest...');
const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
const manifest = yaml.load(manifestContent);

const games = {};
let totalGames = 0;
let withSteam = 0;
let withConfig = 0;
let withConfigAndSteam = 0;

for (const [gameName, gameData] of Object.entries(manifest)) {
  if (!gameData || typeof gameData !== 'object') continue;
  totalGames++;

  const steamId = gameData.steam?.id;
  if (steamId) withSteam++;

  // Extract config-tagged files
  const configFiles = [];
  if (gameData.files && typeof gameData.files === 'object') {
    for (const [filePath, fileData] of Object.entries(gameData.files)) {
      if (!fileData) continue;
      if (!hasConfigTag(fileData.tags)) continue;
      if (!isWindowsPath(fileData.when)) continue;
      const resolved = resolvePlaceholder(filePath);
      if (!configFiles.includes(resolved)) {
        configFiles.push(resolved);
      }
    }
  }

  // Extract config-tagged registry keys
  const configRegistry = [];
  if (gameData.registry && typeof gameData.registry === 'object') {
    for (const [regPath, regData] of Object.entries(gameData.registry)) {
      if (!regData) continue;
      if (!hasConfigTag(regData.tags)) continue;
      if (!isWindowsPath(regData.when)) continue;
      if (!configRegistry.includes(regPath)) {
        configRegistry.push(regPath);
      }
    }
  }

  if (configFiles.length > 0 || configRegistry.length > 0) {
    withConfig++;
  }

  if (steamId && (configFiles.length > 0 || configRegistry.length > 0)) {
    withConfigAndSteam++;
    games[String(steamId)] = {
      name: gameName,
      installDir: gameData.installDir ? Object.keys(gameData.installDir)[0] : null,
      configFiles: configFiles.slice(0, 5), // limit to 5 config paths per game
      configRegistry: configRegistry.slice(0, 3),
    };
  }
}

console.log(`Total games: ${totalGames}`);
console.log(`With Steam AppID: ${withSteam}`);
console.log(`With config files: ${withConfig}`);
console.log(`With Steam + config: ${withConfigAndSteam}`);

// Ensure output directory exists
const outDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Write compact JSON
const output = {
  version: '1.0',
  source: 'ludusavi-manifest',
  generatedAt: new Date().toISOString(),
  totalGames: withConfigAndSteam,
  games,
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
const fileSize = fs.statSync(OUTPUT_PATH).size;
console.log(`\nOutput: ${OUTPUT_PATH}`);
console.log(`Size: ${(fileSize / 1024).toFixed(1)} KB`);

// Show a few examples
console.log('\n=== Sample entries ===');
const sampleIds = Object.keys(games).slice(0, 5);
for (const id of sampleIds) {
  const g = games[id];
  console.log(`  [${id}] ${g.name}`);
  console.log(`    installDir: ${g.installDir}`);
  console.log(`    configFiles: ${g.configFiles.join(', ')}`);
}
