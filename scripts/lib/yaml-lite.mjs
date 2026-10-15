/**
 * Dependency-free YAML subset parser.
 * Supports block mappings/sequences, flow collections, quoted/plain scalars.
 * @param {string} text
 * @returns {{ value: unknown, errors: Array<{ line: number, message: string }> }}
 */
export function parseYamlLite(text) {
  const errors = [];

  function safeSet(obj, key, val) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, {
        value: val,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      obj[key] = val;
    }
  }

  const rawLines = text.split(/\r?\n/);
  /** @type {Array<{ lineNo: number, indent: number, content: string }>} */
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];
    if (raw.includes("\t")) {
      errors.push({ line: lineNo, message: "tabs are not allowed (use spaces)" });
    }
    const noTab = raw.replace(/\t/g, "  ");
    const indentMatch = noTab.match(/^ */);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const afterIndent = noTab.slice(indent);
    if (afterIndent.trim() === "" || afterIndent.trimStart().startsWith("#")) {
      continue;
    }
    const stripped = stripInlineComment(afterIndent);
    if (stripped.trim() === "") continue;
    lines.push({ lineNo, indent, content: stripped });
  }

  let idx = 0;

  function peek() {
    return idx < lines.length ? lines[idx] : null;
  }

  function isSeqItem(content) {
    return content === "-" || content.startsWith("- ");
  }

  function findColonOutside(s) {
    let inQuote = null;
    let depthSq = 0;
    let depthCu = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuote) {
        if (inQuote === '"') {
          if (ch === '"' && !isEscaped(s, i)) inQuote = null;
        } else {
          if (ch === "'") {
            if (s[i + 1] === "'") {
              i++;
              continue;
            }
            inQuote = null;
          }
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "[") depthSq++;
      else if (ch === "]") depthSq = Math.max(0, depthSq - 1);
      else if (ch === "{") depthCu++;
      else if (ch === "}") depthCu = Math.max(0, depthCu - 1);
      else if (ch === ":" && depthSq === 0 && depthCu === 0) {
        const next = s[i + 1];
        if (next === undefined || /\s/.test(next) || next === '"' || next === "'" || next === "{" || next === "[") {
          return i;
        }
      }
    }
    return null;
  }

  function parseKey(keyRaw, lineNo) {
    const t = keyRaw.trim();
    if (t === "") {
      errors.push({ line: lineNo, message: "empty mapping key" });
      return "";
    }
    if (t[0] === '"' || t[0] === "'") {
      const q = t[0];
      if (t.length < 2 || !t.endsWith(q)) {
        errors.push({ line: lineNo, message: `unterminated quote in key "${t}"` });
        return t.slice(1);
      }
      return unquote(t, lineNo) ?? t.slice(1, -1);
    }
    return t;
  }

  function unquote(s, lineNo) {
    const q = s[0];
    const inner = s.slice(1, -1);
    if (q === '"') {
      let out = "";
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === "\\" && i + 1 < inner.length) {
          const n = inner[i + 1];
          if (n === "n") out += "\n";
          else if (n === "t") out += "\t";
          else if (n === "r") out += "\r";
          else out += n;
          i++;
        } else {
          out += c;
        }
      }
      return out;
    }
    return inner.replace(/''/g, "'");
  }

  function convertScalar(s) {
    const t = s.trim();
    if (t === "" || t === "~" || /^null$/i.test(t)) return null;
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
    if (/^-?\d+$/.test(t)) {
      const n = Number(t);
      if (Number.isSafeInteger(n)) return n;
      return t;
    }
    if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(t) && (/[.eE]/.test(t))) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
    return t;
  }

  function parseInlineValue(valRaw, lineNo) {
    const v = valRaw.trim();
    if (v === "") return null;
    if (v[0] === "|" || v[0] === ">") {
      errors.push({ line: lineNo, message: "multiline strings ('|', '>') are not supported" });
      return null;
    }
    if (v[0] === "&" || v[0] === "*") {
      errors.push({ line: lineNo, message: "anchors and aliases ('&', '*') are not supported" });
      return null;
    }
    if (v[0] === "[" || v[0] === "{") {
      return parseFlowString(v, lineNo);
    }
    if (v[0] === '"' || v[0] === "'") {
      const q = v[0];
      if (v.length < 2 || !v.endsWith(q) || (q === "'" ? !isSingleClosed(v) : !isDoubleClosed(v))) {
        errors.push({ line: lineNo, message: "unterminated quote" });
        const inner = v.slice(1);
        if (q === '"') return inner.replace(/\\(.)/g, "$1");
        return inner;
      }
      if (q === '"' && v.slice(1, -1).includes("#")) {
        // fine, already handled
      }
      const innerCheck = v.slice(1, -1);
      void innerCheck;
      return unquote(v, lineNo);
    }
    if (v.includes("\t")) {
      errors.push({ line: lineNo, message: "tabs are not allowed (use spaces)" });
    }
    // bare scalar containing unbalanced brackets/quotes?
    const openSq = (v.match(/\[/g) || []).length - (v.match(/\]/g) || []).length;
    const openCu = (v.match(/\{/g) || []).length - (v.match(/\}/g) || []).length;
    if (openSq !== 0 || openCu !== 0) {
      errors.push({ line: lineNo, message: "unterminated bracket" });
    }
    if ((v.match(/"/g) || []).length % 2 !== 0 || (v.match(/'/g) || []).length % 2 !== 0) {
      // could be apostrophe inside plain scalar like "don't"? YAML plain can contain '. Avoid false positive:
      // only error if starts/contains quote unbalanced and looks like quoting attempt.
      // We check: if value contains a quote char, verify balanced outside the other quote type is complex; skip unless obvious.
    }
    return convertScalar(v);
  }

  function isDoubleClosed(s) {
    if (!s.endsWith('"') || s.length < 2) return false;
    let escaped = false;
    for (let i = 1; i < s.length; i++) {
      const c = s[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') return i === s.length - 1;
    }
    return false;
  }

  function isEscaped(s, pos) {
    let bs = 0;
    for (let i = pos - 1; i >= 0 && s[i] === "\\"; i--) bs++;
    return bs % 2 === 1;
  }

  function isSingleClosed(s) {
    if (!s.endsWith("'") || s.length < 2) return false;
    let i = 1;
    let closed = false;
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (i === s.length - 1) {
          closed = true;
          break;
        }
        return false;
      }
      i++;
    }
    return closed;
  }

  function parseFlowString(s, lineNo) {
    let i = 0;
    const n = s.length;
    function skipSpaces() {
      while (i < n && /\s/.test(s[i])) i++;
    }
    function parseValue() {
      skipSpaces();
      if (i >= n) {
        errors.push({ line: lineNo, message: "unterminated bracket" });
        return null;
      }
      const ch = s[i];
      if (ch === '"') return parseDouble();
      if (ch === "'") return parseSingle();
      if (ch === "[") return parseSeq();
      if (ch === "{") return parseMap();
      if (ch === "|" || ch === ">") {
        errors.push({ line: lineNo, message: "multiline strings ('|', '>') are not supported" });
        const start = i;
        while (i < n && ![",", "]", "}"].includes(s[i])) i++;
        return s.slice(start, i).trim();
      }
      if (ch === "&" || ch === "*") {
        errors.push({ line: lineNo, message: "anchors and aliases ('&', '*') are not supported" });
        i++;
        while (i < n && ![",", "]", "}"].includes(s[i])) i++;
        return null;
      }
      if (ch === "," || ch === "]" || ch === "}") {
        errors.push({ line: lineNo, message: "unexpected character in flow collection" });
        i++;
        return null;
      }
      return parsePlain();
    }
    function parseDouble() {
      i++; // opening
      let out = "";
      let closed = false;
      while (i < n) {
        const c = s[i];
        if (c === "\\" && i + 1 < n) {
          const nx = s[i + 1];
          if (nx === "n") out += "\n";
          else if (nx === "t") out += "\t";
          else if (nx === "r") out += "\r";
          else out += nx;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        out += c;
        i++;
      }
      if (!closed) errors.push({ line: lineNo, message: "unterminated quote" });
      return out;
    }
    function parseSingle() {
      i++;
      let out = "";
      let closed = false;
      while (i < n) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        out += s[i];
        i++;
      }
      if (!closed) errors.push({ line: lineNo, message: "unterminated quote" });
      return out;
    }
    function parsePlain() {
      let start = i;
      let inQ = null;
      while (i < n) {
        const c = s[i];
        if (inQ) {
          if (inQ === '"' && c === '"' && !isEscaped(s, i)) inQ = null;
          else if (inQ === "'" && c === "'") {
            if (s[i + 1] === "'") {
              i += 2;
              continue;
            }
            inQ = null;
          }
          i++;
          continue;
        }
        if (c === '"' || c === "'") {
          inQ = c;
          i++;
          continue;
        }
        if (c === "," || c === "]" || c === "}") break;
        if (c === "[" || c === "{") break;
        if (c === ":") {
          // inside flow plain, colon terminates only for map keys; for plain values colon followed by space/comma/bracket is part of? Actually plain values shouldn't contain ': '.
          // We stop plain at ':' when parsing map keys elsewhere; here for values, ':' is allowed only if not followed by space? Keep as part of plain unless it's a separator confusion. To keep simple, include ':' in plain.
        }
        i++;
      }
      const tok = s.slice(start, i).trim();
      if (tok === "") return null;
      if (tok[0] === "|" || tok[0] === ">" || tok[0] === "&" || tok[0] === "*") {
        // already handled at parseValue start, but plain starting with these after spaces?
      }
      return convertScalar(tok);
    }
    function parseSeq() {
      i++; // [
      const arr = [];
      skipSpaces();
      if (i < n && s[i] === "]") {
        i++;
        return arr;
      }
      while (true) {
        skipSpaces();
        if (i >= n) {
          errors.push({ line: lineNo, message: "unterminated bracket" });
          break;
        }
        if (s[i] === "]") {
          i++;
          break;
        }
        arr.push(parseValue());
        skipSpaces();
        if (i >= n) {
          errors.push({ line: lineNo, message: "unterminated bracket" });
          break;
        }
        if (s[i] === ",") {
          i++;
          continue;
        }
        if (s[i] === "]") {
          i++;
          break;
        }
        errors.push({ line: lineNo, message: "expected ',' or ']' in flow sequence" });
        break;
      }
      return arr;
    }
    function parseMap() {
      i++; // {
      const obj = {};
      skipSpaces();
      if (i < n && s[i] === "}") {
        i++;
        return obj;
      }
      while (true) {
        skipSpaces();
        if (i >= n) {
          errors.push({ line: lineNo, message: "unterminated bracket" });
          break;
        }
        if (s[i] === "}") {
          i++;
          break;
        }
        // parse key until ':'
        const keyStart = i;
        let inQ = null;
        let colonPos = -1;
        let depthSq = 0;
        let depthCu = 0;
        while (i < n) {
          const c = s[i];
          if (inQ) {
            if (inQ === '"' && c === '"' && !isEscaped(s, i)) inQ = null;
            else if (inQ === "'" && c === "'") {
              if (s[i + 1] === "'") {
                i += 2;
                continue;
              }
              inQ = null;
            }
            i++;
            continue;
          }
          if (c === '"' || c === "'") {
            inQ = c;
            i++;
            continue;
          }
          if (c === "[") depthSq++;
          else if (c === "]") depthSq--;
          else if (c === "{") depthCu++;
          else if (c === "}") {
            if (depthCu === 0 && depthSq === 0) break;
            depthCu--;
          } else if (c === ":" && depthSq === 0 && depthCu === 0) {
            colonPos = i;
            break;
          } else if (c === "," && depthSq === 0 && depthCu === 0) {
            break;
          }
          i++;
        }
        if (colonPos === -1) {
          errors.push({ line: lineNo, message: "expected ':' in flow mapping" });
          break;
        }
        const keyRaw = s.slice(keyStart, colonPos).trim();
        let key;
        if ((keyRaw[0] === '"' && keyRaw.endsWith('"')) || (keyRaw[0] === "'" && keyRaw.endsWith("'"))) {
          key = keyRaw[0] === '"' ? parseDoubleLiteral(keyRaw) : keyRaw.slice(1, -1).replace(/''/g, "'");
        } else {
          key = keyRaw;
        }
        if (key === "") {
          errors.push({ line: lineNo, message: "empty mapping key" });
        }
        i = colonPos + 1;
        skipSpaces();
        let val = null;
        if (i < n && (s[i] === "," || s[i] === "}")) {
          val = null;
        } else if (i >= n) {
          errors.push({ line: lineNo, message: "unterminated bracket" });
          val = null;
        } else {
          val = parseValue();
        }
        if (Object.hasOwn(obj, key)) {
          errors.push({ line: lineNo, message: `duplicate key "${key}"` });
        } else {
          safeSet(obj, key, val);
        }
        skipSpaces();
        if (i >= n) {
          errors.push({ line: lineNo, message: "unterminated bracket" });
          break;
        }
        if (s[i] === ",") {
          i++;
          continue;
        }
        if (s[i] === "}") {
          i++;
          break;
        }
        errors.push({ line: lineNo, message: "expected ',' or '}' in flow mapping" });
        break;
      }
      return obj;
    }
    function parseDoubleLiteral(lit) {
      const inner = lit.slice(1, -1);
      let out = "";
      for (let k = 0; k < inner.length; k++) {
        if (inner[k] === "\\" && k + 1 < inner.length) {
          const nx = inner[k + 1];
          if (nx === "n") out += "\n";
          else if (nx === "t") out += "\t";
          else out += nx;
          k++;
        } else out += inner[k];
      }
      return out;
    }

    const val = parseValue();
    skipSpaces();
    if (i < n) {
      const rest = s.slice(i).trim();
      if (rest !== "") {
        // Check for unterminated quote/bracket leftovers
        if (rest.includes('"') || rest.includes("'")) {
          // If original had quote issues already reported, don't double-report; otherwise report trailing
          if (!errors.some((e) => e.line === lineNo && e.message.includes("quote"))) {
            errors.push({ line: lineNo, message: `unexpected trailing content "${rest}"` });
          }
        } else if (!errors.some((e) => e.line === lineNo)) {
          errors.push({ line: lineNo, message: `unexpected trailing content "${rest}"` });
        }
      }
    }
    return val;
  }

  function parseBlock(parentIndent) {
    const cur = peek();
    if (!cur || cur.indent <= parentIndent) {
      return { value: null, next: idx };
    }
    if (isSeqItem(cur.content)) return parseSequence(parentIndent);
    if (findColonOutside(cur.content) !== null) return parseMapping(parentIndent);
    // single scalar
    const line = lines[idx++];
    return { value: parseInlineValue(line.content, line.lineNo), next: idx };
  }

  function parseMapping(parentIndent) {
    const first = peek();
    const mapIndent = first.indent;
    if (mapIndent <= parentIndent) {
      errors.push({ line: first.lineNo, message: `bad indentation: expected indent greater than ${parentIndent}` });
    }
    const obj = {};
    while (idx < lines.length) {
      const cur = peek();
      if (cur.indent < mapIndent) break;
      if (cur.indent > mapIndent) {
        errors.push({ line: cur.lineNo, message: `bad indentation: unexpected indent ${cur.indent} (expected ${mapIndent})` });
        idx++;
        continue;
      }
      if (isSeqItem(cur.content)) break;
      const colonIdx = findColonOutside(cur.content);
      if (colonIdx === null) {
        errors.push({ line: cur.lineNo, message: "expected ':' for mapping entry" });
        idx++;
        continue;
      }
      const keyRaw = cur.content.slice(0, colonIdx).trim();
      const valRaw = cur.content.slice(colonIdx + 1).trim();
      const lineNo = cur.lineNo;
      const key = parseKey(keyRaw, lineNo);
      if (Object.hasOwn(obj, key)) {
        errors.push({ line: lineNo, message: `duplicate key "${key}"` });
      }
      idx++;
      if (valRaw.startsWith("|") || valRaw.startsWith(">")) {
        errors.push({ line: lineNo, message: "multiline strings ('|', '>') are not supported" });
        if (!Object.hasOwn(obj, key)) safeSet(obj, key, null);
        else {
          // keep first
        }
        continue;
      }
      if (valRaw.startsWith("&") || valRaw.startsWith("*")) {
        errors.push({ line: lineNo, message: "anchors and aliases ('&', '*') are not supported" });
        if (!Object.hasOwn(obj, key)) safeSet(obj, key, null);
        continue;
      }
      if (valRaw === "") {
        const nxt = peek();
        if (nxt && nxt.indent > mapIndent) {
          const child = parseBlock(mapIndent);
          if (!Object.hasOwn(obj, key)) safeSet(obj, key, child.value);
        } else {
          if (!Object.hasOwn(obj, key)) safeSet(obj, key, null);
        }
      } else {
        const v = parseInlineValue(valRaw, lineNo);
        if (!Object.hasOwn(obj, key)) safeSet(obj, key, v);
      }
    }
    return { value: obj, next: idx };
  }

  function parseSequence(parentIndent) {
    const first = peek();
    const seqIndent = first.indent;
    const arr = [];
    while (idx < lines.length) {
      const cur = peek();
      if (cur.indent < seqIndent) break;
      if (cur.indent > seqIndent) {
        errors.push({ line: cur.lineNo, message: `bad indentation: unexpected indent ${cur.indent} (expected ${seqIndent})` });
        idx++;
        continue;
      }
      if (!isSeqItem(cur.content)) break;
      const lineNo = cur.lineNo;
      const rest = cur.content === "-" ? "" : cur.content.slice(1).trim();
      idx++;
      if (rest === "") {
        const nxt = peek();
        if (nxt && nxt.indent > seqIndent) {
          const child = parseBlock(seqIndent);
          arr.push(child.value);
        } else {
          arr.push(null);
        }
        continue;
      }
      if (rest.startsWith("|") || rest.startsWith(">")) {
        errors.push({ line: lineNo, message: "multiline strings ('|', '>') are not supported" });
        arr.push(null);
        continue;
      }
      if (rest.startsWith("&") || rest.startsWith("*")) {
        errors.push({ line: lineNo, message: "anchors and aliases ('&', '*') are not supported" });
        arr.push(null);
        continue;
      }
      const startsFlow = rest[0] === "[" || rest[0] === "{";
      const colonIdx = startsFlow ? null : findColonOutside(rest);
      if (colonIdx !== null) {
        const mapObj = {};
        const keyRaw = rest.slice(0, colonIdx).trim();
        const valRaw = rest.slice(colonIdx + 1).trim();
        const key = parseKey(keyRaw, lineNo);
        if (valRaw.startsWith("|") || valRaw.startsWith(">")) {
          errors.push({ line: lineNo, message: "multiline strings ('|', '>') are not supported" });
          safeSet(mapObj, key, null);
        } else if (valRaw.startsWith("&") || valRaw.startsWith("*")) {
          errors.push({ line: lineNo, message: "anchors and aliases ('&', '*') are not supported" });
          safeSet(mapObj, key, null);
        } else if (valRaw === "") {
          const nxt = peek();
          if (nxt && nxt.indent > seqIndent) {
            const child = parseBlock(seqIndent);
            safeSet(mapObj, key, child.value);
          } else {
            safeSet(mapObj, key, null);
          }
        } else {
          safeSet(mapObj, key, parseInlineValue(valRaw, lineNo));
        }
        // continuation lines for this map item
        const nxt = peek();
        if (nxt && nxt.indent > seqIndent && !isSeqItem(nxt.content)) {
          const cont = parseMapping(seqIndent);
          for (const [k, v] of Object.entries(cont.value ?? {})) {
            if (Object.hasOwn(mapObj, k)) {
              errors.push({ line: lineNo, message: `duplicate key "${k}"` });
            } else {
              safeSet(mapObj, k, v);
            }
          }
        }
        arr.push(mapObj);
      } else {
        arr.push(parseInlineValue(rest, lineNo));
      }
    }
    return { value: arr, next: idx };
  }

  function stripInlineComment(s) {
    let inQuote = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuote) {
        if (inQuote === '"') {
          if (ch === '"' && !isEscaped(s, i)) inQuote = null;
        } else {
          if (ch === "'") {
            if (s[i + 1] === "'") {
              i++;
              continue;
            }
            inQuote = null;
          }
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
        return s.slice(0, i).trimEnd();
      }
    }
    return s.trimEnd();
  }

  let value = null;
  if (lines.length > 0) {
    const root = parseBlock(-1);
    value = root.value;
    // leftover lines with bad indentation already handled; if idx < lines.length, report
    while (idx < lines.length) {
      const cur = lines[idx];
      errors.push({ line: cur.lineNo, message: "bad indentation: unexpected content" });
      idx++;
    }
  }

  return { value, errors };
}
