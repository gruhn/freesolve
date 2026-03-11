import * as math from 'mathjs';

// Names that exist on the math object (builtins like pi, e, sin, cos, ...)
const MATH_BUILTINS = new Set(Object.getOwnPropertyNames(math));

export type ResultType = 'empty' | 'solved' | 'check-ok' | 'check-fail' | 'unsolved' | 'expression' | 'error';

export interface LineResult {
  type: ResultType;
  variable?: string;
  value?: number;
  message?: string;
}

function getUnknownSymbols(expr: string, scope: Record<string, number>): string[] {
  try {
    const symbols = new Set<string>();
    math.parse(expr).traverse((node: any) => {
      if (node.type === 'SymbolNode' && !MATH_BUILTINS.has(node.name)) {
        symbols.add(node.name);
      }
    });
    return [...symbols].filter(s => !(s in scope));
  } catch {
    return [];
  }
}

// Assumes equation is linear in `unknown`. Returns null if it isn't or fails.
function solveLinear(
  lhs: string,
  rhs: string,
  unknown: string,
  scope: Record<string, number>
): number | null {
  try {
    const s0 = { ...scope, [unknown]: 0 };

    // Use symbolic derivative for the coefficient — avoids catastrophic cancellation
    // that occurs with finite differences when the unknown's solution is large
    // relative to the evaluation points (e.g. E ≈ 5e7, eval at 0 and 1).
    const exprNode = math.parse(`(${lhs}) - (${rhs})`);
    const derivNode = math.derivative(exprNode, unknown);
    const a = Number(math.evaluate(derivNode.toString(), scope)); // constant for linear eqs
    const b = Number(math.evaluate(lhs, s0)) - Number(math.evaluate(rhs, s0));

    if (Math.abs(a) < 1e-15 * (Math.abs(b) + 1)) return null; // degenerate

    const result = -b / a;

    // Verify the solution (catches nonlinear equations where linear approx is wrong)
    const sv = { ...scope, [unknown]: result };
    const lhsV = Number(math.evaluate(lhs, sv));
    const rhsV = Number(math.evaluate(rhs, sv));
    const residual = Math.abs(lhsV - rhsV);
    const scale = Math.abs(lhsV) + Math.abs(rhsV) + 1;

    if (residual / scale > 1e-6) return null; // not linear in unknown

    return result;
  } catch {
    return null;
  }
}

interface Equation {
  lineIndex: number;
  lhs: string;
  rhs: string;
}

interface Expression {
  lineIndex: number;
  expr: string;
}

export function solve(text: string): LineResult[] {
  const lines = text.split('\n');
  const results: LineResult[] = lines.map(() => ({ type: 'empty' as ResultType }));
  const equations: Equation[] = [];
  const expressions: Expression[] = [];

  // --- Parse lines ---
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();

    if (!raw || raw.startsWith('//') || raw.startsWith('#')) continue;

    // Find `=` that isn't part of <=, >=, !=, ==
    let eqPos = -1;
    for (let j = 0; j < raw.length; j++) {
      const ch = raw[j];
      const prev = raw[j - 1];
      const next = raw[j + 1];
      if (ch === '=' && prev !== '<' && prev !== '>' && prev !== '!' && next !== '=') {
        eqPos = j;
        break;
      }
    }

    if (eqPos === -1) {
      // No `=` — treat as a pure expression to evaluate
      try {
        math.parse(raw); // validate it parses
        expressions.push({ lineIndex: i, expr: raw });
        results[i] = { type: 'unsolved' };
      } catch {
        results[i] = { type: 'error', message: 'invalid expression' };
      }
      continue;
    }

    const lhs = raw.slice(0, eqPos).trim();
    const rhs = raw.slice(eqPos + 1).trim();

    if (!lhs || !rhs) {
      results[i] = { type: 'error', message: 'incomplete equation' };
      continue;
    }

    equations.push({ lineIndex: i, lhs, rhs });
    results[i] = { type: 'unsolved' };
  }

  // --- Constraint propagation ---
  const scope: Record<string, number> = {};
  let changed = true;

  while (changed) {
    changed = false;

    for (const { lineIndex, lhs, rhs } of equations) {
      if (results[lineIndex].type !== 'unsolved') continue;

      const unknowns = getUnknownSymbols(`(${lhs}) - (${rhs})`, scope);

      if (unknowns.length === 0) {
        // All variables known — validate the equation
        try {
          const lhsVal = Number(math.evaluate(lhs, scope));
          const rhsVal = Number(math.evaluate(rhs, scope));
          const residual = Math.abs(lhsVal - rhsVal);
          const scale = Math.abs(lhsVal) + Math.abs(rhsVal) + 1;
          if (residual / scale < 1e-6) {
            results[lineIndex] = { type: 'check-ok', value: lhsVal };
          } else {
            results[lineIndex] = { type: 'check-fail', value: lhsVal };
          }
        } catch (e) {
          results[lineIndex] = { type: 'error', message: String(e) };
        }
        continue;
      }

      if (unknowns.length === 1) {
        const unknown = unknowns[0];
        const value = solveLinear(lhs, rhs, unknown, scope);
        if (value !== null && isFinite(value)) {
          scope[unknown] = value;
          results[lineIndex] = { type: 'solved', variable: unknown, value };
          changed = true;
        }
        // If null: nonlinear or unsolvable — leave as 'unsolved'
      }
      // 2+ unknowns: can't solve yet, come back next iteration
    }
  }

  // --- Evaluate pure expressions ---
  for (const { lineIndex, expr } of expressions) {
    const unknowns = getUnknownSymbols(expr, scope);
    if (unknowns.length === 0) {
      try {
        const value = Number(math.evaluate(expr, scope));
        results[lineIndex] = { type: 'expression', value };
      } catch (e) {
        results[lineIndex] = { type: 'error', message: String(e) };
      }
    }
    // else: still has unknowns → stays 'unsolved'
  }

  return results;
}
