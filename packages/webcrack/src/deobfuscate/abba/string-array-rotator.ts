import * as t from '@babel/types';
import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:string-array-rotator');

export interface StringArrayRotatorOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Detects and executes the string array rotation IIFE pattern.
 *
 * Target pattern:
 * ```javascript
 * (function(e, f) {
 *     var g = function(h) {
 *         while (--h) {
 *             e['push'](e['shift']());
 *         }
 *     };
 *     g(++f);
 * }(a, 0xc3));
 * ```
 *
 * This rotates the array `a` by moving elements from front to back.
 * The `++f` pre-increment adds 1 to the base rotation count.
 */
export default {
  name: 'abba-string-array-rotator',
  tags: ['unsafe'],
  scope: true, // Need scope to find bindings
  visitor(options?: StringArrayRotatorOptions) {
    const debugLog = options?.debug ?? (() => {});

    return {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;

        // 1. Match Structure: (function(e,f){...})(arrayName, number)
        if (!t.isFunctionExpression(callee)) return;
        if (args.length !== 2) return;
        if (!t.isIdentifier(args[0])) {
          debugLog('rotator: first arg is not identifier');
          return;
        }
        if (!t.isNumericLiteral(args[1])) {
          debugLog('rotator: second arg is not numeric literal');
          return;
        }

        const arrayName = args[0].name;
        let rotationAmount = args[1].value;

        debugLog('rotator: potential match for array %s with base rotation %d', arrayName, rotationAmount);

        // 2. Verify Logic: Check for "push" and "shift" in the body (heuristic)
        const functionBodyCode = JSON.stringify(callee.body);
        if (!functionBodyCode.includes('push') || !functionBodyCode.includes('shift')) {
          debugLog('rotator: %s - no push/shift found in body', arrayName);
          return;
        }

        // 3. Locate the Array Declaration via scope binding
        const binding = path.scope.getBinding(arrayName);
        if (!binding) {
          debugLog('rotator: %s - no binding found', arrayName);
          return;
        }

        if (!t.isVariableDeclarator(binding.path.node)) {
          debugLog('rotator: %s - binding is not VariableDeclarator', arrayName);
          return;
        }

        const init = binding.path.node.init;
        if (!t.isArrayExpression(init)) {
          debugLog('rotator: %s - init is not ArrayExpression (type: %s)', arrayName, init?.type);
          return;
        }

        // 4. Detect the '++f' increment nuance
        // Look for the inner function call: g(++f) or similar
        const bodyStatements = callee.body.body;

        for (const stmt of bodyStatements) {
          if (!t.isExpressionStatement(stmt)) continue;
          if (!t.isCallExpression(stmt.expression)) continue;

          const innerArgs = stmt.expression.arguments;
          if (innerArgs.length === 0) continue;

          const firstArg = innerArgs[0];
          // Check if argument is UpdateExpression with prefix ++
          if (t.isUpdateExpression(firstArg) && firstArg.operator === '++' && firstArg.prefix) {
            debugLog('rotator: %s - detected prefix ++, adding 1 to rotation', arrayName);
            rotationAmount += 1;
            break;
          }
        }

        logger('%s: rotating array by %d positions', arrayName, rotationAmount);
        debugLog('rotator: %s - array has %d elements', arrayName, init.elements.length);

        // 5. Rotate the AST Nodes
        const elements = init.elements;
        if (!elements || elements.length === 0) {
          debugLog('rotator: %s - array has no elements', arrayName);
          return;
        }

        // Normalize rotation amount (in case it's larger than array length)
        const effectiveRotation = rotationAmount % elements.length;
        debugLog('rotator: %s - effective rotation: %d', arrayName, effectiveRotation);

        // Apply rotation: shift from front, push to back
        for (let i = 0; i < effectiveRotation; i++) {
          const firstElement = elements.shift();
          if (firstElement !== undefined) {
            elements.push(firstElement);
          }
        }

        debugLog('rotator: %s - rotation complete, first element now: %s',
          arrayName,
          t.isStringLiteral(elements[0]) ? elements[0].value.substring(0, 20) : elements[0]?.type
        );

        // 6. Cleanup: Remove the rotation IIFE
        path.remove();
        this.changes++;

        logger('%s: removed rotation IIFE', arrayName);
      },
    };
  },
} satisfies Transform<StringArrayRotatorOptions>;
