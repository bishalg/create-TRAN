// Verifies: REQ-SCR-008 (web part)
/**
 * The web half of the conformance manifest (ADR-0038 decision 6): after each screen scenario's
 * given state, each `When` and the last `Then`, `e2e/steps/screens.steps.ts` asks for a snapshot of
 * what the browser exposes to assistive technology, and `pnpm screens:check` compares it with the
 * contract. Roles and names are Chromium's own (`Accessibility.getFullAXTree`), not computed here.
 *
 * Each scenario writes its snapshots to a part file, because Playwright runs scenarios in parallel
 * workers; the global teardown joins the parts into `e2e/conformance/web.json`
 * (`e2e/conformance/README.md`).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CDPSession, Page } from '@playwright/test';

export const CONFORMANCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'conformance');
const PARTS_DIR = join(CONFORMANCE_DIR, '.web-parts');
export const WEB_MANIFEST = join(CONFORMANCE_DIR, 'web.json');

/** ARIA widget roles: a node with one of these takes a click or text input. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

/** Text runs Chromium hangs under every element: they are the content, not nodes of their own. */
const TEXT_ROLES = new Set(['StaticText', 'InlineTextBox', 'LineBreak']);

/** Why Chromium leaves a node out of the tree when it is not on screen at all. */
const HIDDEN_REASONS = new Set([
  'notRendered',
  'notVisible',
  'ariaHiddenElement',
  'ariaHiddenSubtree',
  'inertElement',
  'inertSubtree',
  'activeModalDialog',
]);

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManifestElement {
  id?: string;
  role: string;
  name: string;
  /** What the node reads besides its name: a field's value, a region's text. */
  value?: string;
  interactive: boolean;
  frame: Frame;
  unit: 'css_px';
  /** The nearest ancestor carrying a contract id (a segmented control's option names its control). */
  within?: string;
}

export interface Snapshot {
  platform: 'web';
  scenario: string;
  phase: string;
  locale: string;
  elements: ManifestElement[];
}

interface AXValue {
  value?: unknown;
}
interface AXNode {
  nodeId: string;
  ignored: boolean;
  ignoredReasons?: { name: string }[];
  role?: AXValue;
  name?: AXValue;
  value?: AXValue;
  childIds?: string[];
  backendDOMNodeId?: number;
}
interface DOMNode {
  backendNodeId: number;
  attributes?: string[];
  children?: DOMNode[];
  shadowRoots?: DOMNode[];
  contentDocument?: DOMNode;
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();
function session(page: Page): Promise<CDPSession> {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  return cdp;
}

/** Every DOM node's contract id and parent, by backend id. */
function indexDom(root: DOMNode) {
  const testId = new Map<number, string>();
  const parent = new Map<number, number>();
  const walk = (node: DOMNode) => {
    const attributes = node.attributes ?? [];
    for (let i = 0; i < attributes.length; i += 2) {
      if (attributes[i] === 'data-testid') testId.set(node.backendNodeId, attributes[i + 1]!);
    }
    for (const child of [
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
      ...(node.contentDocument ? [node.contentDocument] : []),
    ]) {
      parent.set(child.backendNodeId, node.backendNodeId);
      walk(child);
    }
  };
  walk(root);
  return { testId, parent };
}

const text = (value: AXValue | undefined) =>
  typeof value?.value === 'string' ? value.value.replace(/\s+/g, ' ').trim() : '';

/** What the page exposes now: every node with a contract id, and every interactive node. */
export async function snapshotWeb(page: Page): Promise<ManifestElement[]> {
  const cdp = await session(page);
  const [{ nodes }, { root }] = await Promise.all([
    cdp.send('Accessibility.getFullAXTree') as Promise<{ nodes: AXNode[] }>,
    cdp.send('DOM.getDocument', { depth: -1, pierce: true }) as Promise<{ root: DOMNode }>,
  ]);
  const dom = indexDom(root);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  /** The text runs under a node, joined: what a screen reader reads inside it. */
  const contents = (node: AXNode): string =>
    (node.childIds ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is AXNode => child !== undefined)
      .map((child) => (text(child.role) === 'StaticText' ? text(child.name) : contents(child)))
      .filter(Boolean)
      .join(' ');
  const within = (backend: number): string | undefined => {
    for (let at = dom.parent.get(backend); at !== undefined; at = dom.parent.get(at)) {
      const id = dom.testId.get(at);
      if (id) return id;
    }
    return undefined;
  };

  // A node with a contract id that Chromium prunes from the full tree as uninteresting (a plain
  // `span`) is still on screen: ask for it by its DOM node.
  const listed = new Set(nodes.map((node) => node.backendDOMNodeId));
  for (const backend of dom.testId.keys()) {
    if (listed.has(backend)) continue;
    const partial = (await cdp
      .send('Accessibility.getPartialAXTree', { backendNodeId: backend, fetchRelatives: false })
      .catch(() => ({ nodes: [] }))) as { nodes: AXNode[] };
    const node = partial.nodes.find((candidate) => candidate.backendDOMNodeId === backend);
    if (!node) continue;
    nodes.push(node);
    for (const child of partial.nodes) if (!byId.has(child.nodeId)) byId.set(child.nodeId, child);
  }

  const elements: ManifestElement[] = [];
  for (const node of nodes) {
    const backend = node.backendDOMNodeId;
    const role = text(node.role);
    if (backend === undefined || TEXT_ROLES.has(role)) continue;
    const id = dom.testId.get(backend);
    if (node.ignored && (!id || node.ignoredReasons?.some((r) => HIDDEN_REASONS.has(r.name))))
      continue;
    const interactive = !node.ignored && INTERACTIVE_ROLES.has(role);
    if (!id && !interactive) continue;
    let frame: Frame;
    try {
      const { model } = (await cdp.send('DOM.getBoxModel', { backendNodeId: backend })) as {
        model: { border: number[]; width: number; height: number };
      };
      frame = {
        x: model.border[0]!,
        y: model.border[1]!,
        width: model.width,
        height: model.height,
      };
    } catch {
      continue; // no layout box: not on screen
    }
    const name = node.ignored ? '' : text(node.name);
    const value = text(node.value) || contents(node) || (await innerText(cdp, backend));
    elements.push({
      ...(id ? { id } : {}),
      role: node.ignored ? 'generic' : role,
      name,
      ...(value && value !== name ? { value } : {}),
      interactive,
      frame,
      unit: 'css_px',
      ...(within(backend) ? { within: within(backend) } : {}),
    });
  }
  return elements;
}

/** The rendered text of a node Chromium gives no text runs (a pruned `span`). */
async function innerText(cdp: CDPSession, backendNodeId: number): Promise<string> {
  try {
    const { object } = (await cdp.send('DOM.resolveNode', { backendNodeId })) as {
      object: { objectId: string };
    };
    const { result } = (await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { return this.innerText ?? ""; }',
      returnByValue: true,
    })) as { result: { value?: unknown } };
    return typeof result.value === 'string' ? result.value.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

/** One scenario's snapshots, appended as it runs and written once per change. */
export class ScenarioManifest {
  private readonly snapshots: Snapshot[] = [];
  private readonly file: string;

  constructor(
    testId: string,
    private readonly scenario: string,
    private readonly locale: () => string
  ) {
    this.file = join(PARTS_DIR, `${testId.replace(/[^\w-]/g, '_')}.json`);
  }

  /** Records the page's tree after `phase`, unless it is the same as the last one recorded. */
  async record(page: Page, phase: string) {
    const elements = await snapshotWeb(page);
    const last = this.snapshots.at(-1);
    if (last && JSON.stringify(last.elements) === JSON.stringify(elements)) return;
    this.snapshots.push({
      platform: 'web',
      scenario: this.scenario,
      phase,
      locale: this.locale(),
      elements,
    });
    mkdirSync(PARTS_DIR, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.snapshots));
  }
}

/** Global setup: a run starts from no parts, so a stale scenario never reaches the manifest. */
export function clearParts() {
  rmSync(PARTS_DIR, { recursive: true, force: true });
}

/** Global teardown: joins every scenario's snapshots into one manifest, in scenario order. */
export function joinParts() {
  let files: string[];
  try {
    files = readdirSync(PARTS_DIR).filter((file) => file.endsWith('.json'));
  } catch {
    return; // no screen scenario ran (a filtered run)
  }
  const snapshots: Snapshot[] = files
    .flatMap((file) => JSON.parse(readFileSync(join(PARTS_DIR, file), 'utf8')) as Snapshot[])
    .sort((a, b) => a.scenario.localeCompare(b.scenario));
  writeFileSync(WEB_MANIFEST, JSON.stringify({ platform: 'web', snapshots }, null, 1) + '\n');
  clearParts();
}
