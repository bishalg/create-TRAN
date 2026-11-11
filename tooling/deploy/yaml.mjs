/**
 * A small YAML reader for the block style the repo's workflow and Compose files use, so the deploy
 * tests assert on the parsed job graph and services instead of matching text. Zero dependencies
 * (ADR-0016): maps, sequences, `- key: value` items, `|` / `>` block scalars, `[a, b]` flow
 * sequences, `{}`, quoted strings, comments, booleans and integers. `<<: *anchor` merges, and `&name`
 * anchors on a map value. Anything else throws, so an unsupported construct fails the test loudly.
 */

/** The line without a trailing comment: a `#` at the start or after a space, outside quotes. */
function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const KEY = /^((?:'[^']*'|"[^"]*"|[^\s'"#][^:]*?)):(?:\s+(.*)|)$/;

function unquote(text) {
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  if (text.startsWith('"') && text.endsWith('"')) return JSON.parse(text);
  return text;
}

function splitFlow(inner) {
  const items = [];
  let quote = '';
  let current = '';
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = '';
      current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === ',') {
      items.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function scalar(text) {
  const value = text.trim();
  if (value.startsWith('[') && value.endsWith(']'))
    return splitFlow(value.slice(1, -1)).map(scalar);
  if (value === '{}') return {};
  if (value.startsWith('{')) throw new Error(`yaml: flow maps are not supported: ${value}`);
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === 'null' || value === '~') return null;
  return unquote(value);
}

/** Parses `text`; throws on what it does not understand. */
export function parseYaml(text) {
  const lines = text.split('\n').map((raw) => {
    const content = stripComment(raw).trimEnd();
    return { raw, content, indent: content.length - content.trimStart().length };
  });
  const anchors = new Map();
  let i = 0;
  const blank = () => i < lines.length && !lines[i].content.trim();
  const skip = () => {
    while (blank()) i++;
  };
  const isItem = (line) => /^-(\s|$)/.test(line.content.trimStart());

  function block(indent) {
    skip();
    if (i >= lines.length) return null;
    return isItem(lines[i]) ? sequence(lines[i].indent) : map(lines[i].indent, indent);
  }

  function value(rest, indent) {
    if (rest === undefined || rest === '') {
      skip();
      const next = lines[i];
      if (next && (next.indent > indent || (next.indent === indent && isItem(next))))
        return block(next.indent);
      return null;
    }
    const anchor = /^&([\w-]+)(?:\s+(.*))?$/.exec(rest);
    if (anchor) {
      const parsed = value(anchor[2], indent);
      anchors.set(anchor[1], parsed);
      return parsed;
    }
    const alias = /^\*([\w-]+)$/.exec(rest);
    if (alias) {
      if (!anchors.has(alias[1])) throw new Error(`yaml: unknown anchor ${alias[1]}`);
      return anchors.get(alias[1]);
    }
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(indent, rest[0] === '>');
    return scalar(rest);
  }

  function blockScalar(indent, folded) {
    const body = [];
    let base = -1;
    for (; i < lines.length; i++) {
      const { raw } = lines[i];
      if (!raw.trim()) {
        body.push('');
        continue;
      }
      const own = raw.length - raw.trimStart().length;
      if (own <= indent) break;
      if (base < 0) base = own;
      body.push(raw.slice(base));
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    return `${body.join(folded ? ' ' : '\n')}\n`;
  }

  function map(indent) {
    const result = {};
    for (skip(); i < lines.length && lines[i].indent === indent && !isItem(lines[i]); skip()) {
      const text = lines[i].content.trim();
      const match = KEY.exec(text);
      if (!match) throw new Error(`yaml: line ${i + 1}: cannot read "${text}"`);
      const key = unquote(match[1].trim());
      i++;
      const parsed = value(match[2], indent);
      if (key === '<<') Object.assign(result, parsed);
      else result[key] = parsed;
    }
    if (i < lines.length && lines[i].indent > indent && !blank())
      throw new Error(`yaml: line ${i + 1}: unexpected indentation`);
    return result;
  }

  function sequence(indent) {
    const result = [];
    for (skip(); i < lines.length && lines[i].indent === indent && isItem(lines[i]); skip()) {
      const line = lines[i];
      const after = line.content.slice(indent + 1);
      const rest = after.trimStart();
      if (!rest) {
        i++;
        result.push(block(indent));
        continue;
      }
      if (KEY.test(rest)) {
        const column = indent + 1 + (after.length - rest.length);
        lines[i] = { raw: line.raw, content: ' '.repeat(column) + rest, indent: column };
        result.push(map(column));
      } else {
        i++;
        result.push(scalar(rest));
      }
    }
    return result;
  }

  const parsed = block(-1);
  skip();
  if (i < lines.length) throw new Error(`yaml: line ${i + 1}: unexpected content`);
  return parsed;
}
