// Safe formula parser for user-defined moments. No eval(): only numbers, variables,
// + − × ÷ ^, brackets and a fixed list of maths functions are understood.
// Trigonometric functions take angles in DEGREES (naval architecture convention: cos(theta)).
import { EngineError } from './math';

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'fn'; name: string; args: Node[] };

const D = Math.PI / 180;
export const FUNCTIONS: Record<string, { n: number | 'many'; f: (...x: number[]) => number; help: string }> = {
  sin: { n: 1, f: (x) => Math.sin(x * D), help: 'sine (degrees)' },
  cos: { n: 1, f: (x) => Math.cos(x * D), help: 'cosine (degrees)' },
  tan: { n: 1, f: (x) => Math.tan(x * D), help: 'tangent (degrees)' },
  asin: { n: 1, f: (x) => Math.asin(x) / D, help: 'arc sine (result in degrees)' },
  acos: { n: 1, f: (x) => Math.acos(x) / D, help: 'arc cosine (result in degrees)' },
  atan: { n: 1, f: (x) => Math.atan(x) / D, help: 'arc tangent (result in degrees)' },
  sqrt: { n: 1, f: Math.sqrt, help: 'square root' },
  abs: { n: 1, f: Math.abs, help: 'absolute value' },
  exp: { n: 1, f: Math.exp, help: 'e to the power x' },
  ln: { n: 1, f: Math.log, help: 'natural logarithm' },
  log10: { n: 1, f: Math.log10, help: 'logarithm base 10' },
  rad: { n: 1, f: (x) => x * D, help: 'degrees to radians' },
  deg: { n: 1, f: (x) => x / D, help: 'radians to degrees' },
  min: { n: 'many', f: Math.min, help: 'smallest value' },
  max: { n: 'many', f: Math.max, help: 'largest value' },
  pow: { n: 2, f: Math.pow, help: 'x to the power y' },
};
const CONSTANTS: Record<string, number> = { pi: Math.PI };

export interface Formula { source: string; ast: Node; variables: string[] }

export function parseFormula(source: string): Formula {
  const toks = tokenize(source);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (v: string) => {
    if (peek()?.v !== v) throw err(`Expected "${v}"${peek() ? ` but found "${peek().v}"` : ' at the end'}.`);
    i++;
  };
  function expr(): Node {
    let a = term();
    while (peek()?.v === '+' || peek()?.v === '-') { const op = next().v as '+' | '-'; a = { t: 'bin', op, a, b: term() }; }
    return a;
  }
  function term(): Node {
    let a = unary();
    while (peek()?.v === '*' || peek()?.v === '/') { const op = next().v as '*' | '/'; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary(): Node {
    if (peek()?.v === '-') { next(); return { t: 'neg', a: unary() }; }
    if (peek()?.v === '+') { next(); return unary(); }
    return power();
  }
  function power(): Node {
    const a = atom();
    if (peek()?.v === '^') { next(); return { t: 'bin', op: '^', a, b: unary() }; }
    return a;
  }
  function atom(): Node {
    const tk = next();
    if (!tk) throw err('The formula ends too early.');
    if (tk.k === 'num') return { t: 'num', v: Number(tk.v) };
    if (tk.k === 'id') {
      if (peek()?.v === '(') {
        const fn = FUNCTIONS[tk.v.toLowerCase()];
        if (!fn) throw err(`Unknown function "${tk.v}". Available: ${Object.keys(FUNCTIONS).join(', ')}.`);
        next();
        const args: Node[] = [];
        if (peek()?.v !== ')') { args.push(expr()); while (peek()?.v === ',') { next(); args.push(expr()); } }
        expect(')');
        if (fn.n !== 'many' && args.length !== fn.n) throw err(`${tk.v}() needs ${fn.n} value(s).`);
        return { t: 'fn', name: tk.v.toLowerCase(), args };
      }
      if (tk.v in CONSTANTS) return { t: 'num', v: CONSTANTS[tk.v] };
      return { t: 'var', name: tk.v };
    }
    if (tk.v === '(') { const e = expr(); expect(')'); return e; }
    throw err(`Unexpected "${tk.v}".`);
  }
  if (!toks.length) throw err('Enter a formula.');
  const ast = expr();
  if (i < toks.length) throw err(`Unexpected "${toks[i].v}".`);
  const vars: string[] = [];
  (function walk(n: Node) {
    if (n.t === 'var' && !vars.includes(n.name)) vars.push(n.name);
    if (n.t === 'neg') walk(n.a);
    if (n.t === 'bin') { walk(n.a); walk(n.b); }
    if (n.t === 'fn') n.args.forEach(walk);
  })(ast);
  return { source, ast, variables: vars };
}

export function evaluate(f: Formula, values: Record<string, number>): number {
  const ev = (n: Node): number => {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': {
        const v = values[n.name];
        if (v === undefined || !Number.isFinite(v)) throw err(`No value for "${n.name}".`);
        return v;
      }
      case 'neg': return -ev(n.a);
      case 'bin': {
        const a = ev(n.a), b = ev(n.b);
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        if (n.op === '/') { if (b === 0) throw err('Division by zero.'); return a / b; }
        return Math.pow(a, b);
      }
      case 'fn': return FUNCTIONS[n.name].f(...n.args.map(ev));
    }
  };
  const r = ev(f.ast);
  if (!Number.isFinite(r)) throw err('The formula does not give a finite number with these values.');
  return r;
}

function err(m: string) { return new EngineError('FORMULA', m); }

function tokenize(s: string): { k: 'num' | 'id' | 'op'; v: string }[] {
  const out: { k: 'num' | 'id' | 'op'; v: string }[] = [];
  const src = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ k: 'num', v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_Ͱ-ϿΔ][A-Za-z0-9_Ͱ-Ͽ]*/.exec(src.slice(i));
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw err(`The character "${c}" is not allowed in a formula.`);
  }
  return out;
}
