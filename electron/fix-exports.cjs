const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'api-handlers.cjs');
let s = fs.readFileSync(file, 'utf8');

// Find the module.exports block and replace it
const startMarker = '// ─── Exports';
const startIdx = s.indexOf(startMarker);
if (startIdx === -1) {
  console.log('ERROR: exports marker not found');
  process.exit(1);
}

// Find the module.exports = { line
const exportsStart = s.indexOf('module.exports = {', startIdx);
if (exportsStart === -1) {
  console.log('ERROR: module.exports not found');
  process.exit(1);
}

// Find the matching closing };
// We need to find the line that is just "};" after the exports object
const afterExports = s.substring(exportsStart);
// Find the last }; in the file (it should be the end of module.exports)
const lastClose = s.lastIndexOf('};');
if (lastClose === -1 || lastClose < exportsStart) {
  console.log('ERROR: closing }; not found');
  process.exit(1);
}

const newExports = `// ─── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  // Game detection
  detectGame,
  detectAllGames,
  // Custom adapters
  getCustomAdaptersDir,
  listCustomAdapters,
  saveCustomAdapter,
  deleteCustomAdapter,
  generateAdapterFromLudusavi,
  // Config write
  writeGameConfig,
  // LoL
  readLolSettings,
  startLolSaveWatch,
  getLolWatchStatus,
  // Presets
  listLocalPresets,
  saveLocalPreset,
  loadLocalPreset,
  deleteLocalPreset,
};
`;

// Replace from startMarker to end of file
s = s.substring(0, startIdx) + newExports;

fs.writeFileSync(file, s, 'utf8');
console.log('exports 已替换，新文件大小:', s.length, 'bytes');
