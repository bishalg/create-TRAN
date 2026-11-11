/**
 * The additive check over `fixtures/contract/<version>/openapi.json` (spec 034 REQ-CON-011): every
 * operation is flattened into dotted fields (`user.role`, `items[]`, `labels.*` for a map value),
 * then two flattenings are compared by the rules of REQ-CON-011. Local `$ref`s are resolved and a
 * cycle is cut where it closes. Plain Node, no dependencies.
 */
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

const join = (path, segment) => (path ? `${path}.${segment}` : segment);
const label = (path) => path || 'body';

function pointer(doc, ref) {
  if (!ref.startsWith('#/')) throw new Error(`only local $ref is supported, got ${ref}`);
  let node = doc;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  }
  return node;
}

/** Follows `$ref` (siblings win) and merges `allOf`; `ref` names the outermost reference. */
function resolve(doc, schema) {
  let ref;
  let node = schema ?? {};
  while (node.$ref) {
    const { $ref, ...rest } = node;
    ref ??= $ref;
    node = { ...pointer(doc, $ref), ...rest };
  }
  if (node.allOf) {
    const { allOf, ...rest } = node;
    const parts = allOf.map((part) => resolve(doc, part).node);
    node = parts.reduce(
      (merged, part) => ({
        ...merged,
        ...part,
        properties: { ...merged.properties, ...part.properties },
        required: [...(merged.required ?? []), ...(part.required ?? [])],
      }),
      { ...rest, properties: rest.properties, required: rest.required }
    );
  }
  return { node, ref };
}

/** Every field of `schema` by dotted path → what the rules compare. */
export function flatten(
  doc,
  schema,
  { required = true, into = new Map(), path = '', stack = [] } = {}
) {
  const { node, ref } = resolve(doc, schema);
  const types = [].concat(node.type ?? []);
  into.set(path, {
    type: types
      .filter((t) => t !== 'null')
      .sort()
      .join('|'),
    nullable: types.includes('null'),
    required,
    format: node.format,
    hasConst: 'const' in node,
    const: node.const,
    enum: node.enum,
    wire: 'x-tran-wire-enum' in node,
    bounds: Object.fromEntries(
      ['minimum', 'maximum', 'minLength', 'maxLength']
        .filter((k) => k in node)
        .map((k) => [k, node[k]])
    ),
    closed: node.additionalProperties === false,
  });
  if (ref && stack.includes(ref)) return into;
  const next = ref ? [...stack, ref] : stack;
  const wanted = new Set(node.required ?? []);
  for (const [key, child] of Object.entries(node.properties ?? {}))
    flatten(doc, child, { required: wanted.has(key), into, path: join(path, key), stack: next });
  if (node.items) flatten(doc, node.items, { into, path: `${path}[]`, stack: next });
  if (node.additionalProperties && typeof node.additionalProperties === 'object')
    flatten(doc, node.additionalProperties, {
      required: false,
      into,
      path: join(path, '*'),
      stack: next,
    });
  return into;
}

const jsonSchema = (content) => content?.['application/json']?.schema;

/** `"<METHOD> <path>"` → `{ auth, headers, request, responses }`, each operation flattened. */
export function operations(doc) {
  const found = new Map();
  for (const [template, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS.filter((m) => item[m])) {
      const op = item[method];
      const security = op.security ?? doc.security ?? [];
      const headers = new Map();
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(
        (p) => resolve(doc, p).node
      );
      for (const p of params)
        if (p.in === 'header')
          headers.set(p.name.toLowerCase(), { name: p.name, required: p.required === true });
      const body = op.requestBody && resolve(doc, op.requestBody).node;
      const request = jsonSchema(body?.content)
        ? flatten(doc, jsonSchema(body.content), { required: body.required === true })
        : new Map();
      const responses = new Map();
      for (const [status, raw] of Object.entries(op.responses ?? {})) {
        const schema = jsonSchema(resolve(doc, raw).node.content);
        responses.set(status, schema ? flatten(doc, schema) : new Map());
      }
      found.set(`${method.toUpperCase()} ${template}`, {
        auth: security.some((s) => Object.keys(s).length > 0),
        headers,
        request,
        responses,
      });
    }
  }
  return found;
}

const parentOf = (path) =>
  path.endsWith('[]')
    ? path.slice(0, -2)
    : path.includes('.')
      ? path.slice(0, path.lastIndexOf('.'))
      : '';
const show = (value) => JSON.stringify(value);

function diffRequestFields(name, before, after, problems) {
  for (const [path, was] of before) {
    const is = after.get(path);
    const at = `${name}: request field ${label(path)}`;
    if (!is) {
      problems.push(`${at} was removed`);
      continue;
    }
    if (is.required && !was.required) problems.push(`${at} is now required`);
    if (is.type !== was.type) problems.push(`${at} changed type from ${was.type} to ${is.type}`);
    for (const value of was.enum ?? [])
      if (is.enum && !is.enum.some((v) => show(v) === show(value)))
        problems.push(`${at} no longer accepts ${show(value)}`);
    for (const [key, limit] of Object.entries(is.bounds)) {
      const old = was.bounds[key];
      const narrower = key.startsWith('min')
        ? old === undefined || limit > old
        : old === undefined || limit < old;
      if (narrower) problems.push(`${at} ${key} narrowed from ${old ?? 'unbounded'} to ${limit}`);
    }
    if (is.format && is.format !== was.format)
      problems.push(
        was.format
          ? `${at} format changed from ${was.format} to ${is.format}`
          : `${at} format ${is.format} was added`
      );
    if (is.closed && !was.closed)
      problems.push(`${at} shape was made closed (additionalProperties: false)`);
  }
  for (const [path, is] of after)
    if (!before.has(path) && is.required && before.has(parentOf(path)))
      problems.push(`${name}: request field ${label(path)} was added as required`);
}

function diffResponseFields(where, before, after, problems) {
  for (const [path, was] of before) {
    const is = after.get(path);
    const at = `${where}: response field ${label(path)}`;
    if (!is) {
      problems.push(`${at} was removed`);
      continue;
    }
    if (was.required && !is.required) problems.push(`${at} was made optional`);
    if (!was.nullable && is.nullable) problems.push(`${at} was made nullable`);
    if (is.type !== was.type) problems.push(`${at} changed type from ${was.type} to ${is.type}`);
    if (is.format !== was.format)
      problems.push(`${at} changed format from ${was.format ?? 'none'} to ${is.format ?? 'none'}`);
    if (show(is.const) !== show(was.const) || is.hasConst !== was.hasConst)
      problems.push(`${at} changed constant from ${show(was.const)} to ${show(is.const)}`);
  }
}

/** Breaking differences between two OpenAPI documents (REQ-CON-011), each naming operation and field. */
export function diffOpenapi(before, after) {
  const [old, now] = [operations(before), operations(after)];
  const problems = [];
  for (const [name, was] of old) {
    const is = now.get(name);
    if (!is) {
      problems.push(`${name}: operation removed`);
      continue;
    }
    if (is.auth && !was.auth) problems.push(`${name}: authentication was added`);
    for (const [key, header] of is.headers) {
      const prior = was.headers.get(key);
      if (header.required && !prior?.required)
        problems.push(
          `${name}: request header ${header.name} is ${prior ? 'now' : 'newly'} required`
        );
    }
    diffRequestFields(name, was.request, is.request, problems);
    for (const [status, fields] of was.responses) {
      const current = is.responses.get(status);
      if (!current) {
        if (/^2/.test(status)) problems.push(`${name} ${status}: no longer answered`);
        continue;
      }
      diffResponseFields(`${name} ${status}`, fields, current, problems);
    }
  }
  return problems;
}
