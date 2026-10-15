// Auto-convert vite.config.ts helper functions to CommonJS api-handlers.cjs
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'vite.config.ts');
const OUT = path.join(__dirname, 'api-handlers.cjs');

let lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

// ── Step 1: Keep only lines 1..1950 (helpers, before vite plugin) ────────
lines = lines.slice(0, 1950);

// ── Step 2: Remove multi-line `type X = { ... }` declarations ──────────────
let result = [];
let inTypeBlock = false;
let braceDepth = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!inTypeBlock) {
    // Detect start of type declaration: `type X = {` or `type X = { ... }` on one line
    const typeStart = line.match(/^\s*type\s+\w+\s*=\s*\{/);
    const typeOneLine = line.match(/^\s*type\s+\w+\s*=\s*\{.*\}\s*$/);
    if (typeOneLine) continue; // skip single-line type
    if (typeStart) {
      inTypeBlock = true;
      braceDepth = 1;
      // Check if this line also closes the block
      const rest = line.slice(line.indexOf('{') + 1);
      for (const ch of rest) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) inTypeBlock = false;
      continue;
    }
    // Also skip single-line type aliases that aren't blocks: `type X = Y;`
    if (/^\s*type\s+\w+\s*=\s*[^=].*;?\s*$/.test(line) && !line.includes('{')) continue;
    result.push(line);
  } else {
    // Inside type block: count braces
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    if (braceDepth <= 0) inTypeBlock = false;
    // skip the line entirely
  }
}
lines = result;

// ── Step 2b: Remove multi-line variable type annotations (const x: {...} =) ─
// These span multiple lines and can't be handled by per-line regex.
{
  const text = lines.join('\n');
  const cleaned = removeMultiLineVarTypes(text);
  lines = cleaned.split('\n');
}

// ── Step 2c: Remove multi-line function return types (): {...} => ───────────
{
  const text = lines.join('\n');
  const cleaned = removeMultiLineReturnTypes(text);
  lines = cleaned.split('\n');
}

// ── Step 3: Convert imports ──────────────────────────────────────────────────
result = [];
for (const line of lines) {
  // Skip vite-specific imports
  if (/from\s+['"]vite['"]/.test(line)) continue;
  if (/from\s+['"]@vitejs\/plugin-react['"]/.test(line)) continue;
  if (/from\s+['"]node-global-key-listener['"]/.test(line)) continue;
  // Convert: import { a, b } from 'x'  →  const { a, b } = require('x')
  let m = line.match(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
  if (m) {
    result.push(`const {${m[1].trim()}} = require('${m[2]}');`);
    continue;
  }
  // Convert: import x from 'y'  →  const x = require('y')
  m = line.match(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (m) {
    result.push(`const ${m[1]} = require('${m[2]}');`);
    continue;
  }
  // Convert: import * as x from 'y'
  m = line.match(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (m) {
    result.push(`const ${m[1]} = require('${m[2]}');`);
    continue;
  }
  result.push(line);
}
lines = result;

// ── Step 4: Remove inline type annotations using a token-aware approach ─────
function removeAsAssertions(line) {
  // Find ` as ` and skip the type expression using balanced bracket scanning.
  // Stops at top-level separators: ; , ) ] } whitespace-end
  let out = '';
  let i = 0;
  while (i < line.length) {
    // Look for " as " (word boundary)
    if (i > 0 && line.slice(i, i + 4) === ' as ' && /[\w)\]]/.test(line[i - 1])) {
      // Skip " as "
      i += 4;
      // Skip the type expression with balanced brackets
      let depth = 0;
      let inStr = false;
      let strCh = '';
      while (i < line.length) {
        const c = line[i];
        if (inStr) {
          if (c === strCh) inStr = false;
          i++;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; i++; continue; }
        if (c === '<' || c === '[' || c === '{' || c === '(') { depth++; i++; continue; }
        if (c === '>' || c === ']' || c === '}' || c === ')') {
          if (depth === 0) { out += c; i++; break; } // top-level close bracket — stop here, preserve it
          depth--;
          i++;
          continue;
        }
        if (depth === 0 && (c === ';' || c === ',' || c === '\n')) { out += c; i++; break; }
        i++;
      }
      // Don't add anything — the type is removed
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

function removeReturnTypes(line) {
  // Find `): Type` patterns and remove the type, keeping `)`.
  // Type can be: identifier, generic<...>, array[], object {...}, union A|B, etc.
  // Stops when we hit `{` (function body), `=>` (arrow), `;` (end), or newline.
  let out = '';
  let i = 0;
  while (i < line.length) {
    // Look for `):` (close paren followed by colon, not inside string)
    if (line[i] === ')' && i + 1 < line.length && line[i + 1] === ':') {
      out += ')'; // keep the paren
      i += 2; // skip '):'
      // Skip whitespace
      while (i < line.length && line[i] === ' ') { i++; }
      // Skip the type expression with balanced brackets
      let depth = 0;
      let inStr = false;
      let strCh = '';
      while (i < line.length) {
        const c = line[i];
        if (inStr) {
          if (c === strCh) inStr = false;
          i++;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; i++; continue; }
        if (c === '<' || c === '[' || c === '{' || c === '(') { depth++; i++; continue; }
        if (c === '>' || c === ']' || c === '}' || c === ')') {
          if (depth === 0) break; // top-level close — stop
          depth--;
          i++;
          continue;
        }
        if (depth === 0) {
          // Stop at function body `{`, arrow `=>`, semicolon, or end of line.
          // Preserve the terminator in the output.
          if (c === '{') { out += '{'; i++; break; }
          if (c === '=' && i + 1 < line.length && line[i + 1] === '>') { out += '=>'; i += 2; break; }
          if (c === ';' || c === '\n') { out += c; i++; break; }
        }
        i++;
      }
      // Don't add the type — it's removed
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

function removeMultiLineVarTypes(text) {
  // Find `const/let/var name: <type>` where <type> may span multiple lines,
  // and remove the type (keep `name` and the `= value` part).
  // Uses balanced bracket scanning.
  let out = '';
  let i = 0;
  const kwRegex = /\b(const|let|var)\s+(\w+)\s*:/y;
  while (i < text.length) {
    kwRegex.lastIndex = i;
    const m = kwRegex.exec(text);
    if (m && m.index === i) {
      out += m[1] + ' ' + m[2]; // keep "const name"
      i = m.index + m[0].length; // skip past the colon
      // Skip whitespace including newlines
      while (i < text.length && /\s/.test(text[i])) i++;
      // Skip the type expression with balanced brackets
      let depth = 0;
      let inStr = false;
      let strCh = '';
      while (i < text.length) {
        const c = text[i];
        if (inStr) {
          if (c === strCh) inStr = false;
          i++;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; i++; continue; }
        if (c === '<' || c === '[' || c === '{' || c === '(') { depth++; i++; continue; }
        if (c === '>' || c === ']' || c === '}' || c === ')') {
          if (depth === 0) break;
          depth--;
          i++;
          continue;
        }
        if (depth === 0 && c === '=') { out += '='; i++; break; } // found the initializer, preserve '='
        if (depth === 0 && c === ';') { out += ';'; i++; break; } // no initializer
        if (depth === 0 && c === '\n') { break; } // simple type ended at line break (no initializer, ASI)
        i++;
      }
      // Don't add the type
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function removeMultiLineReturnTypes(text) {
  // Find `): <type>` where <type> may span multiple lines, and remove it.
  // Preserves the terminator: `=>` (arrow function) or `{` (function body) or `;`.
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === ')' && i + 1 < text.length && text[i + 1] === ':') {
      out += ')';
      i += 2;
      // Skip whitespace including newlines
      while (i < text.length && /\s/.test(text[i])) i++;
      // Skip the type expression with balanced brackets
      let depth = 0;
      let inStr = false;
      let strCh = '';
      while (i < text.length) {
        const c = text[i];
        if (inStr) { if (c === strCh) inStr = false; i++; continue; }
        if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; i++; continue; }
        if (c === '<' || c === '[' || c === '{' || c === '(') { depth++; i++; continue; }
        if (c === '>' || c === ']' || c === '}' || c === ')') {
          if (depth === 0) { out += c; i++; break; } // top-level close, preserve
          depth--; i++; continue;
        }
        if (depth === 0) {
          if (c === '{') { out += '{'; i++; break; } // function body start
          if (c === '=' && i + 1 < text.length && text[i + 1] === '>') { out += '=>'; i += 2; break; }
          if (c === ';' || c === '\n') { out += c; i++; break; }
        }
        i++;
      }
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function removeGenericNew(line) {
  // Remove generic type parameters from `new TypeName<...>(` patterns.
  // Uses balanced angle-bracket scanning to handle nested generics.
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line.slice(i, i + 4) === 'new ' && i + 4 < line.length) {
      out += 'new ';
      i += 4;
      // Read the type name
      let name = '';
      while (i < line.length && /[\w$.]/.test(line[i])) { name += line[i]; i++; }
      out += name;
      // Skip whitespace
      while (i < line.length && line[i] === ' ') { out += line[i]; i++; }
      // Check for generic params
      if (line[i] === '<') {
        // Skip balanced <...>
        let depth = 0;
        while (i < line.length) {
          const c = line[i];
          if (c === '<') depth++;
          else if (c === '>') { depth--; if (depth === 0) { i++; break; } }
          i++;
        }
        // Don't add the generic params
        continue;
      }
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

function stripTypes(line) {
  // 4a: Remove `import.meta.dirname` → join(__dirname, '..') (api-handlers.cjs is in electron/)
  line = line.replace(/import\.meta\.dirname/g, "join(__dirname, '..')");

  // 4b: Remove `as Type` assertions using balanced-bracket scanning
  line = removeAsAssertions(line);

  // 4b2: Remove generic type params from constructor calls: new Type<...>( → new Type(
  line = removeGenericNew(line);

  // 4b3: Remove TypeScript non-null assertion operator: x! → x (but not !x logical not)
  line = line.replace(/(?<=[\w)\]}])!(?=[\s;,)\]}]|$)/g, '');

  // 4b4: Remove optional parameter marker: name? → name (inside function param lists)
  line = line.replace(/(\w+)\?(?=[,)])/g, '$1');

  // 4c: Remove variable declaration types: const/let/var name: Type =
  line = line.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=;]+?(?=\s*=)/g, '$1 $2');

  // 4d: Remove function return types using balanced-bracket scanning
  line = removeReturnTypes(line);

  // 4e: Remove parameter types in function signatures: (name: Type, name2: Type2)
  // This is the trickiest. We process character by character for balanced brackets.
  line = stripParamTypes(line);

  return line;
}

function stripParamTypes(line) {
  // Find function-like parameter lists and strip types from them.
  // We look for patterns: identifier( ... ) where inside we have name: type pairs.
  // Simple approach: within parentheses that are part of arrow/function params,
  // remove ": Type" segments at top level (not inside nested <>, {}, []).
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '(') {
      // Find matching close paren, tracking nested brackets
      let depth = 1;
      let j = i + 1;
      let angleDepth = 0, braceDepth = 0, bracketDepth = 0;
      while (j < line.length && depth > 0) {
        const c = line[j];
        if (c === '<') angleDepth++;
        else if (c === '>') angleDepth = Math.max(0, angleDepth - 1);
        else if (c === '{') braceDepth++;
        else if (c === '}') braceDepth = Math.max(0, braceDepth - 1);
        else if (c === '[') bracketDepth++;
        else if (c === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (c === '(' && angleDepth === 0 && braceDepth === 0 && bracketDepth === 0) depth++;
        else if (c === ')' && angleDepth === 0 && braceDepth === 0 && bracketDepth === 0) depth--;
        j++;
      }
      if (depth === 0) {
        const inside = line.slice(i + 1, j - 1);
        // Only strip types if this looks like a parameter list (contains ':')
        if (inside.includes(':') && !inside.includes('=>') && !inside.includes('return')) {
          const stripped = stripTypesInsideParens(inside);
          out += '(' + stripped + ')';
          i = j;
          continue;
        }
      }
      out += ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function stripTypesInsideParens(inside) {
  // If the content is entirely string literals / function calls, skip type stripping
  // (e.g. require('node:child_process') should not be mangled)
  const trimmedAll = inside.trim();
  if (trimmedAll.startsWith("'") || trimmedAll.startsWith('"') || trimmedAll.startsWith('`')) {
    return inside; // pure string argument
  }
  // Split by top-level commas, then for each param remove ": Type"
  const parts = [];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let current = '';
  for (const ch of inside) {
    if (inString) {
      current += ch;
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);

  return parts.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return p;
    // Skip string literals and function-call arguments
    if (trimmed.startsWith("'") || trimmed.startsWith('"') || trimmed.startsWith('`')) return trimmed;
    // Skip parameters that contain ternary operators (? followed by space/bracket)
    // — the colon in a ternary is not a type annotation.
    if (/\?[\s\{[]/.test(trimmed)) return trimmed;
    // Find the top-level colon (not inside strings/brackets)
    let d = 0;
    let inStr = false;
    let strCh = '';
    let colonIdx = -1;
    for (let k = 0; k < trimmed.length; k++) {
      const c = trimmed[k];
      if (inStr) { if (c === strCh) inStr = false; continue; }
      if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; continue; }
      if (c === '<' || c === '{' || c === '[' || c === '(') d++;
      else if (c === '>' || c === '}' || c === ']' || c === ')') d = Math.max(0, d - 1);
      else if (c === ':' && d === 0) { colonIdx = k; break; }
    }
    if (colonIdx >= 0) {
      return trimmed.slice(0, colonIdx).trim();
    }
    return trimmed;
  }).join(', ');
}

lines = lines.map(stripTypes);

// ── Step 5: Clean up artifacts ───────────────────────────────────────────────
lines = lines.map(l => {
  // Remove trailing semicolons from function declarations (they were expressions)
  // e.g. `const foo = (x) => {` is fine, but `const foo = (x): string => {` became `const foo = (x) => {`
  // Remove double spaces
  l = l.replace(/  +/g, ' ');
  // Remove `):` that became `):` with nothing (already handled)
  return l;
});

// ── Step 6: Add module.exports at the end ────────────────────────────────────
// Collect all top-level const/function names
const exportNames = [];
for (const line of lines) {
  let m = line.match(/^\s*const\s+(\w+)\s*=/);
  if (m && !['appDir', 'vitePath', 'isDev', 'distPath'].includes(m[1])) {
    exportNames.push(m[1]);
  }
  m = line.match(/^\s*function\s+(\w+)/);
  if (m) exportNames.push(m[1]);
}
// Deduplicate
const uniqueExports = [...new Set(exportNames)];

lines.push('');
lines.push('// ─── Exports ────────────────────────────────────────────────────────────────');
lines.push('module.exports = {');
for (const name of uniqueExports) {
  lines.push(`  ${name},`);
}
lines.push('};');

// ── Step 7: Write output ──────────────────────────────────────────────────────
const output = lines.join('\n');
fs.writeFileSync(OUT, output, 'utf8');
console.log(`Written ${OUT} (${output.length} bytes, ${lines.length} lines)`);
console.log(`Exported ${uniqueExports.length} names: ${uniqueExports.join(', ')}`);
