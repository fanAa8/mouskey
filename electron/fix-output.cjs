const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'api-handlers.cjs');
let s = fs.readFileSync(file, 'utf8');
let fixes = 0;

// Fix 1: optional parameter marker body? → body
if (/body\?\)/.test(s)) {
  s = s.replace(/body\?\)/g, 'body)');
  console.log('Fixed: body? optional param');
  fixes++;
}

// Fix 2: Find and fix broken ternary operators inside parentheses.
// Pattern: ? (expr)  or  ? expr)  missing the : else branch.
// We look for lines with `?` that don't have a matching `:` at the same level.
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Skip lines that already have a ternary : (rough check)
  if (/\?/.test(line) && !/:\s*[\w\{]/.test(line) && !/=>/.test(line)) {
    // This line might have a broken ternary. Print it for manual review.
    console.log(`Potential broken ternary at line ${i + 1}: ${line.trim()}`);
  }
}

fs.writeFileSync(file, s, 'utf8');
console.log(`Done. Applied ${fixes} fixes.`);
