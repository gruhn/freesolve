import './style.css';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  keymap,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands';
import { solve } from './solver';
import type { LineResult } from './solver';

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

function formatNum(n: number): string {
  if (!isFinite(n)) return String(n);

  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < Math.abs(n) * 1e-9 + 1e-12) {
    return rounded.toLocaleString('en-US');
  }

  const abs = Math.abs(n);
  if (abs >= 0.0001 && abs < 1e7) {
    return parseFloat(n.toPrecision(6)).toString();
  }

  return n.toExponential(4);
}

// ---------------------------------------------------------------------------
// CodeMirror widget for inline results
// ---------------------------------------------------------------------------

class ResultWidget extends WidgetType {
  label: string;
  cls: string;

  constructor(label: string, cls: string) {
    super();
    this.label = label;
    this.cls = cls;
  }

  eq(other: ResultWidget): boolean {
    return other.label === this.label && other.cls === this.cls;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `rw ${this.cls}`;
    el.textContent = this.label;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Build decorations from solver results
// ---------------------------------------------------------------------------

function buildDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const results = solve(text);
  const widgets: Range<Decoration>[] = [];

  for (let i = 0; i < view.state.doc.lines && i < results.length; i++) {
    const result: LineResult = results[i];
    if (!result || result.type === 'empty') continue;

    const line = view.state.doc.line(i + 1);

    let label = '';
    let cls = '';

    switch (result.type) {
      case 'solved': {
        // For direct assignments (q = 0.0054) the result is obvious — skip widget.
        const lhsPart = line.text.split('=')[0].trim();
        const isDirect =
          /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(lhsPart) && result.variable === lhsPart;
        if (isDirect) continue;
        label = `${result.variable} = ${formatNum(result.value!)}`;
        cls = 'rw-solved';
        break;
      }
      case 'check-ok':
        label = '✓';
        cls = 'rw-ok';
        break;
      case 'check-fail':
        label = '✗  contradiction';
        cls = 'rw-fail';
        break;
      case 'expression':
        label = `= ${formatNum(result.value!)}`;
        cls = 'rw-solved';
        break;
      case 'unsolved':
        label = '?';
        cls = 'rw-unsolved';
        break;
      case 'error':
        label = `⚠  ${result.message}`;
        cls = 'rw-error';
        break;
    }

    if (label) {
      widgets.push(
        Decoration.widget({ widget: new ResultWidget(label, cls), side: 1 }).range(line.to)
      );
    }
  }

  return Decoration.set(widgets, true);
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

const solverPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const theme = EditorView.theme(
  {
    '&': {
      fontSize: '15px',
      fontFamily:
        '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, monospace',
      height: '100%',
      background: 'transparent',
    },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': {
      padding: '32px 28px',
      caretColor: '#89b4fa',
      outline: 'none',
    },
    '.cm-line': {
      lineHeight: '1.9',
      padding: '0',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#89b4fa' },
    '.cm-selectionBackground, ::selection': { background: '#313244 !important' },
    '.cm-activeLine': { background: 'rgba(137,180,250,0.05)' },
    // Result widgets
    '.rw': {
      marginLeft: '3ch',
      fontStyle: 'normal',
      userSelect: 'none',
      pointerEvents: 'none',
      fontVariantNumeric: 'tabular-nums',
    },
    '.rw-solved': { color: '#a6e3a1' },
    '.rw-ok': { color: '#45475a' },
    '.rw-fail': { color: '#f38ba8' },
    '.rw-unsolved': { color: '#45475a' },
    '.rw-error': { color: '#f38ba8', fontSize: '0.85em' },
  },
  { dark: true }
);

// ---------------------------------------------------------------------------
// Initial document
// ---------------------------------------------------------------------------

const INITIAL_DOC = `// Write equations — unknowns are solved automatically

q = 0.0054
E * q = 273000
(E * p) * q = 370
`;

// ---------------------------------------------------------------------------
// URL hash sync
// ---------------------------------------------------------------------------

function docFromHash(): string | null {
  const hash = location.hash.slice(1);
  if (!hash) return null;
  try {
    return decodeURIComponent(hash);
  } catch {
    return null;
  }
}

let hashUpdateTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHashUpdate(content: string) {
  if (hashUpdateTimer !== null) clearTimeout(hashUpdateTimer);
  hashUpdateTimer = setTimeout(() => {
    window.history.replaceState(null, '', '#' + encodeURIComponent(content));
    hashUpdateTimer = null;
  }, 300);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const state = EditorState.create({
  doc: docFromHash() ?? INITIAL_DOC,
  extensions: [
    cmHistory(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
    }),
    solverPlugin,
    theme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) scheduleHashUpdate(update.state.doc.toString());
    }),
  ],
});

new EditorView({
  state,
  parent: document.getElementById('editor')!,
});

// ---------------------------------------------------------------------------
// Copy link button
// ---------------------------------------------------------------------------

const copyBtn = document.getElementById('copy-link')!;
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(location.href);
  copyBtn.textContent = 'Copied!';
  setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
});
