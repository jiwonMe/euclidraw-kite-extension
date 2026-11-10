/**
 * Numeric expressions for Style values and constraint arguments.
 *
 *   r: k * 3          angle: deg(30) + theta          width: max(1, scale / 2)
 *
 * Parsed with a Pratt parser into the stack bytecode that the Wasm VM's
 * `eval_expr` executes under a fuel budget (crate-kite-solver/src/vm.rs). The
 * same bytecode is evaluated here only for constant folding at compile time;
 * nothing here can loop, so evaluation is bounded by the code length.
 */

export const X_CONST = 1, X_PARAM = 2, X_ADD = 3, X_SUB = 4, X_MUL = 5, X_DIV = 6, X_NEG = 7, X_POW = 8,
  X_SIN = 9, X_COS = 10, X_TAN = 11, X_SQRT = 12, X_ABS = 13, X_MIN = 14, X_MAX = 15, X_RAD = 16;

const UNARY: Record<string, number> = { sin: X_SIN, cos: X_COS, tan: X_TAN, sqrt: X_SQRT, abs: X_ABS, deg: X_RAD, rad: X_RAD };
const BINARY_FN: Record<string, number> = { min: X_MIN, max: X_MAX, pow: X_POW };
const INFIX: Record<string, [number, number, number]> = { '+': [10, 11, X_ADD], '-': [10, 11, X_SUB], '*': [20, 21, X_MUL], '/': [20, 21, X_DIV], '^': [31, 30, X_POW] };
export const EXPRESSION_FUEL = 256;
const MAX_TOKENS = 200;

export interface Expression {
  readonly code: readonly number[];
  readonly consts: readonly number[];
  /** Parameter names in the order of their `X_PARAM` indices. */
  readonly params: readonly string[];
  readonly constant: boolean;
}

type Token = { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/iy;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new Error(`식을 해석할 수 없습니다: ${source.slice(index).trim()}`);
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: 'num', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: 'id', value: match[2] });
    else tokens.push({ kind: 'op', value: match[3]! });
    if (tokens.length > MAX_TOKENS) throw new Error('식이 너무 깁니다.');
  }
  return tokens;
}

/** Parse an expression. `known` lists the parameter names allowed in it. */
export function parseExpression(source: string, known: ReadonlySet<string> = new Set()): Expression {
  const tokens = tokenize(source);
  if (!tokens.length) throw new Error('빈 식입니다.');
  const code: number[] = [], consts: number[] = [], params: string[] = [];
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expect = (value: string) => {
    const token = take();
    if (!token || token.kind !== 'op' || token.value !== value) throw new Error(`'${value}'가 필요합니다.`);
  };
  const constant = (value: number) => { code.push(X_CONST, consts.length); consts.push(value); };
  const parse = (minimum: number): void => {
    const token = take();
    if (!token) throw new Error('식이 끝났습니다.');
    if (token.kind === 'num') constant(token.value);
    else if (token.kind === 'op' && token.value === '-') { parse(40); code.push(X_NEG); }
    else if (token.kind === 'op' && token.value === '+') parse(40);
    else if (token.kind === 'op' && token.value === '(') { parse(0); expect(')'); }
    else if (token.kind === 'id') {
      const next = peek();
      if (next?.kind === 'op' && next.value === '(') {
        take();
        const name = token.value.toLowerCase();
        if (UNARY[name] !== undefined) { parse(0); expect(')'); code.push(UNARY[name]!); }
        else if (BINARY_FN[name] !== undefined) { parse(0); expect(','); parse(0); expect(')'); code.push(BINARY_FN[name]!); }
        else throw new Error(`알 수 없는 함수: ${token.value}`);
      } else if (token.value === 'pi' || token.value === 'PI') constant(Math.PI);
      else if (known.has(token.value)) {
        let index = params.indexOf(token.value);
        if (index < 0) { index = params.length; params.push(token.value); }
        code.push(X_PARAM, index);
      } else throw new Error(`알 수 없는 파라미터: ${token.value}`);
    } else throw new Error(`예상하지 못한 '${token.value}'`);
    for (;;) {
      const operator = peek();
      if (!operator || operator.kind !== 'op') break;
      const binding = INFIX[operator.value];
      if (!binding || binding[0] < minimum) break;
      take();
      parse(binding[1]);
      code.push(binding[2]);
    }
  };
  parse(0);
  if (position !== tokens.length) throw new Error(`예상하지 못한 '${(peek() as { value: string | number }).value}'`);
  return { code, consts, params, constant: params.length === 0 };
}

/** Reference evaluator with identical semantics to the Wasm VM. */
export function evaluate(expression: Expression, values: readonly number[] = []): number {
  const stack: number[] = [];
  const { code, consts } = expression;
  let fuel = EXPRESSION_FUEL;
  for (let pc = 0; pc < code.length;) {
    if (fuel-- <= 0) throw new Error('식 연료가 부족합니다.');
    const op = code[pc++]!;
    if (op === X_CONST || op === X_PARAM) {
      const index = code[pc++]!;
      const value = op === X_CONST ? consts[index] : values[index];
      if (value === undefined) throw new Error('잘못된 식 피연산자입니다.');
      stack.push(value);
      continue;
    }
    const b = op === X_NEG || op >= X_SIN && op <= X_ABS || op === X_RAD ? 0 : stack.pop()!;
    const a = stack.pop();
    if (a === undefined) throw new Error('잘못된 식입니다.');
    switch (op) {
      case X_ADD: stack.push(a + b); break;
      case X_SUB: stack.push(a - b); break;
      case X_MUL: stack.push(a * b); break;
      case X_DIV: stack.push(a / b); break;
      case X_POW: stack.push(a ** b); break;
      case X_MIN: stack.push(Math.min(a, b)); break;
      case X_MAX: stack.push(Math.max(a, b)); break;
      case X_NEG: stack.push(-a); break;
      case X_SIN: stack.push(Math.sin(a)); break;
      case X_COS: stack.push(Math.cos(a)); break;
      case X_TAN: stack.push(Math.tan(a)); break;
      case X_SQRT: stack.push(Math.sqrt(a)); break;
      case X_ABS: stack.push(Math.abs(a)); break;
      case X_RAD: stack.push(a * Math.PI / 180); break;
      default: throw new Error('알 수 없는 식 명령입니다.');
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error('식의 값이 유한하지 않습니다.');
  return stack[0]!;
}
