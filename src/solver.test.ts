import { describe, it, expect } from 'vitest';
import { solve } from './solver';
import type { LineResult } from './solver';

// Helpers
const solveLines = (lns: string[]): LineResult[] => solve(lns.join('\n'));

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('empty / comment lines', () => {
  it('empty line → type empty', () => {
    const [r] = solve('\n');
    expect(r.type).toBe('empty');
  });

  it('// comment → type empty', () => {
    const [r] = solve('// this is a comment');
    expect(r.type).toBe('empty');
  });

  it('# comment → type empty', () => {
    const [r] = solve('# this too');
    expect(r.type).toBe('empty');
  });

  it('line without = → type error', () => {
    const [r] = solve('just text');
    expect(r.type).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Direct assignment
// ---------------------------------------------------------------------------

describe('direct assignment', () => {
  it('x = 5', () => {
    const [r] = solve('x = 5');
    expect(r.type).toBe('solved');
    expect(r.variable).toBe('x');
    expect(r.value).toBeCloseTo(5);
  });

  it('q = 0.0054', () => {
    const [r] = solve('q = 0.0054');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(0.0054);
  });

  it('negative value', () => {
    const [r] = solve('x = -42');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(-42);
  });

  it('expression on RHS', () => {
    const [r] = solve('x = 2 * 3 + 1');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(7);
  });
});

// ---------------------------------------------------------------------------
// Single unknown, linear
// ---------------------------------------------------------------------------

describe('one unknown, linear', () => {
  it('E * q = 273000 with q known', () => {
    const results = solveLines(['q = 0.0054', 'E * q = 273000']);
    expect(results[1].type).toBe('solved');
    expect(results[1].variable).toBe('E');
    expect(results[1].value).toBeCloseTo(273000 / 0.0054);
  });

  it('unknown on RHS: 273000 = E * q', () => {
    const results = solveLines(['q = 0.0054', '273000 = E * q']);
    expect(results[1].type).toBe('solved');
    expect(results[1].variable).toBe('E');
    expect(results[1].value).toBeCloseTo(273000 / 0.0054);
  });

  it('addition: x + 3 = 10', () => {
    const [r] = solve('x + 3 = 10');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(7);
  });

  it('subtraction: x - 4 = 6', () => {
    const [r] = solve('x - 4 = 6');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(10);
  });

  it('division: x / 4 = 3', () => {
    const [r] = solve('x / 4 = 3');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(12);
  });
});

// ---------------------------------------------------------------------------
// The motivating example (chain propagation)
// ---------------------------------------------------------------------------

describe('motivating example', () => {
  const text = ['q = 0.0054', 'E * q = 273000', '(E * p) * q = 370'];

  it('solves all three lines', () => {
    const results = solveLines(text);
    expect(results[0].type).toBe('solved'); // q
    expect(results[1].type).toBe('solved'); // E
    expect(results[2].type).toBe('solved'); // p
  });

  it('q = 0.0054', () => {
    expect(solveLines(text)[0].value).toBeCloseTo(0.0054);
  });

  it('E ≈ 50,555,556', () => {
    expect(solveLines(text)[1].value).toBeCloseTo(273000 / 0.0054);
  });

  it('p ≈ 370 / 273000', () => {
    const p = solveLines(text)[2].value!;
    expect(p).toBeCloseTo(370 / 273000, 6);
  });
});

// ---------------------------------------------------------------------------
// Multi-step propagation (order matters)
// ---------------------------------------------------------------------------

describe('propagation chain', () => {
  it('solves a 3-step chain in one pass', () => {
    const results = solveLines(['a = 2', 'b = a * 3', 'c = b + 10']);
    expect(results[0].value).toBeCloseTo(2);
    expect(results[1].value).toBeCloseTo(6);
    expect(results[2].value).toBeCloseTo(16);
  });

  it('solves regardless of declaration order (propagation loops)', () => {
    // c depends on b, b depends on a — defined in reverse order
    const results = solveLines(['c = b + 10', 'b = a * 3', 'a = 2']);
    expect(results[2].type).toBe('solved'); // a
    expect(results[1].type).toBe('solved'); // b
    expect(results[0].type).toBe('solved'); // c
    expect(results[0].value).toBeCloseTo(16);
  });
});

// ---------------------------------------------------------------------------
// Validation (check-ok / check-fail)
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('redundant consistent equation → check-ok', () => {
    const results = solveLines(['x = 5', 'x = 5']);
    expect(results[1].type).toBe('check-ok');
  });

  it('overdetermined consistent system → check-ok', () => {
    // x=3, y=4, and x+y=7 is consistent
    const results = solveLines(['x = 3', 'y = 4', 'x + y = 7']);
    expect(results[2].type).toBe('check-ok');
  });

  it('contradictory equation → check-fail', () => {
    const results = solveLines(['x = 5', 'x = 6']);
    expect(results[1].type).toBe('check-fail');
  });

  it('bad sum → check-fail', () => {
    const results = solveLines(['x = 3', 'y = 4', 'x + y = 100']);
    expect(results[2].type).toBe('check-fail');
  });
});

// ---------------------------------------------------------------------------
// Underdetermined / nonlinear (stays unsolved)
// ---------------------------------------------------------------------------

describe('unsolvable cases', () => {
  it('two unknowns → unsolved', () => {
    const [r] = solve('a * b = 10');
    expect(r.type).toBe('unsolved');
  });

  it('nonlinear x^2 = 4 → unsolved (linear solver rejects it)', () => {
    const [r] = solve('x^2 = 4');
    expect(r.type).toBe('unsolved');
  });

  it('nonlinear x * x = 9 → unsolved', () => {
    const [r] = solve('x * x = 9');
    expect(r.type).toBe('unsolved');
  });

  it('unsolvable stays unsolved even after propagation', () => {
    const results = solveLines(['a = 2', 'a * b * c = 10']);
    // one equation, two unknowns (b, c) → stays unsolved
    expect(results[1].type).toBe('unsolved');
  });
});

// ---------------------------------------------------------------------------
// Math builtins are not treated as unknowns
// ---------------------------------------------------------------------------

describe('math builtins', () => {
  it('pi is not an unknown', () => {
    const [r] = solve('x = pi');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(Math.PI);
  });

  it('e is not an unknown', () => {
    const [r] = solve('x = e');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(Math.E);
  });

  it('sin(pi) ≈ 0', () => {
    const [r] = solve('x = sin(pi)');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// Whitespace / formatting tolerance
// ---------------------------------------------------------------------------

describe('whitespace tolerance', () => {
  it('extra spaces around =', () => {
    const [r] = solve('  x  =  42  ');
    expect(r.type).toBe('solved');
    expect(r.value).toBeCloseTo(42);
  });

  it('mixed blank lines and comments', () => {
    const results = solve('// header\n\nx = 10\n\n# note\ny = x * 2');
    const solved = results.filter((r) => r.type === 'solved');
    expect(solved).toHaveLength(2);
    expect(solved[1].value).toBeCloseTo(20);
  });
});
