import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:proxy-inliner');

export interface ProxyInlinerOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Inlines proxy function calls that access the string array.
 *
 * Target patterns (proxy declaration):
 * ```javascript
 * // Pattern 1: FunctionDeclaration
 * function b(d, e) {
 *     d = d - 0x0;
 *     var f = a[d];
 *     return f;
 * }
 *
 * // Pattern 2: VariableDeclarator with FunctionExpression
 * var b = function(d, e) {
 *     d = d - 0x0;
 *     var f = a[d];
 *     return f;
 * };
 * ```
 *
 * Target pattern (usage):
 * ```javascript
 * var x = b('0x0'); // Becomes: var x = "actualString";
 * ```
 */
export default {
  name: 'abba-proxy-inliner',
  tags: ['unsafe'],
  scope: true,
  visitor(options?: ProxyInlinerOptions) {
    const debugLog = options?.debug ?? (() => {});

    let proxyName = '';
    let proxyPath: NodePath<t.VariableDeclarator | t.FunctionDeclaration> | null = null;
    let arrayName = '';
    let offset = 0;
    let stringArray: string[] = [];

    /**
     * Analyzes a function body to detect proxy pattern (array access + offset)
     */
    function analyzeProxyFunction(
      funcName: string,
      params: t.Node[],
      bodyPath: NodePath<t.BlockStatement>,
      scope: NodePath['scope'],
    ): boolean {
      // Proxy functions typically have 1-2 parameters
      if (params.length < 1 || params.length > 2) {
        debugLog('proxy-inliner: %s - wrong param count (%d)', funcName, params.length);
        return false;
      }

      let detectedArrayName = '';
      let detectedOffset = 0;

      bodyPath.traverse({
        // Look for: var f = a[d] (array access pattern)
        VariableDeclarator(innerPath) {
          const innerInit = innerPath.node.init;
          if (!innerInit) return;

          // Pattern: a[d] - computed member expression
          if (
            t.isMemberExpression(innerInit) &&
            innerInit.computed &&
            t.isIdentifier(innerInit.object)
          ) {
            detectedArrayName = innerInit.object.name;
            debugLog('proxy-inliner: %s - found array access to %s', funcName, detectedArrayName);
          }
        },

        // Look for: d = d - 0x0 (offset calculation)
        AssignmentExpression(assignPath) {
          const { right } = assignPath.node;

          // Pattern: d - NUMBER
          if (
            t.isBinaryExpression(right) &&
            right.operator === '-' &&
            t.isNumericLiteral(right.right)
          ) {
            detectedOffset = right.right.value;
            debugLog('proxy-inliner: %s - found offset %d', funcName, detectedOffset);
          }
        },
      });

      // Must have found an array access to be a valid proxy
      if (!detectedArrayName) {
        debugLog('proxy-inliner: %s - no array access found, skipping', funcName);
        return false;
      }

      // Load the string array from the AST
      const binding = scope.getBinding(detectedArrayName);
      if (!binding) {
        debugLog('proxy-inliner: %s - no binding for array %s', funcName, detectedArrayName);
        return false;
      }

      if (!t.isVariableDeclarator(binding.path.node)) {
        debugLog('proxy-inliner: %s - array binding is not VariableDeclarator', funcName);
        return false;
      }

      const arrayInit = binding.path.node.init;
      if (!t.isArrayExpression(arrayInit)) {
        debugLog('proxy-inliner: %s - array init is not ArrayExpression', funcName);
        return false;
      }

      // Extract strings from the array
      const extractedStrings = arrayInit.elements.map((el) =>
        t.isStringLiteral(el) ? el.value : '',
      );

      // Success - capture state
      proxyName = funcName;
      arrayName = detectedArrayName;
      offset = detectedOffset;
      stringArray = extractedStrings;

      logger(
        '%s: identified proxy for array %s (offset: %d, %d strings)',
        proxyName,
        arrayName,
        offset,
        stringArray.length,
      );
      debugLog(
        'proxy-inliner: %s - first few strings: %s',
        proxyName,
        stringArray.slice(0, 3).join(', '),
      );

      return true;
    }

    return {
      // Phase 1a: Identify proxy as FunctionDeclaration
      FunctionDeclaration(path) {
        if (proxyName) return;

        const { id, params, body } = path.node;
        if (!id || !t.isIdentifier(id)) return;

        const funcName = id.name;
        debugLog('proxy-inliner: examining FunctionDeclaration %s', funcName);

        const bodyPath = path.get('body');
        if (analyzeProxyFunction(funcName, params, bodyPath, path.scope)) {
          proxyPath = path;
        }
      },

      // Phase 1b: Identify proxy as VariableDeclarator with FunctionExpression
      VariableDeclarator(path) {
        if (proxyName) return;

        const { id, init } = path.node;
        if (!t.isIdentifier(id)) return;
        if (!t.isFunctionExpression(init)) return;

        const funcName = id.name;
        debugLog('proxy-inliner: examining VariableDeclarator %s', funcName);

        const bodyPath = path.get('init.body') as NodePath<t.BlockStatement>;
        if (!bodyPath || Array.isArray(bodyPath)) return;

        if (analyzeProxyFunction(funcName, init.params, bodyPath, path.scope)) {
          proxyPath = path;
        }
      },

      // Phase 2: Replace all proxy calls with actual strings
      CallExpression: {
        exit(path) {
          if (!proxyName || stringArray.length === 0) return;

          const { callee, arguments: args } = path.node;

          // Check if this is a call to the proxy function
          if (!t.isIdentifier(callee) || callee.name !== proxyName) return;

          if (args.length === 0) {
            debugLog('proxy-inliner: call to %s has no arguments', proxyName);
            return;
          }

          const firstArg = args[0];
          let index: number;

          // Parse the index from the argument
          if (t.isStringLiteral(firstArg)) {
            const val = firstArg.value;
            // Handle hex strings like '0x1a' or decimal strings like '26'
            if (val.startsWith('0x') || val.startsWith('0X')) {
              index = parseInt(val, 16);
            } else {
              index = parseInt(val, 10);
            }
          } else if (t.isNumericLiteral(firstArg)) {
            index = firstArg.value;
          } else {
            debugLog(
              'proxy-inliner: %s call has non-literal argument: %s',
              proxyName,
              firstArg.type,
            );
            return;
          }

          if (isNaN(index)) {
            debugLog('proxy-inliner: %s call has invalid index', proxyName);
            return;
          }

          // Apply the offset
          const finalIndex = index - offset;

          if (finalIndex < 0 || finalIndex >= stringArray.length) {
            debugLog(
              'proxy-inliner: %s(%d) - index %d out of bounds (array length: %d)',
              proxyName,
              index,
              finalIndex,
              stringArray.length,
            );
            return;
          }

          const replacementString = stringArray[finalIndex];

          debugLog(
            'proxy-inliner: %s(%d) -> "%s" (offset: %d, final: %d)',
            proxyName,
            index,
            replacementString.substring(0, 30),
            offset,
            finalIndex,
          );

          path.replaceWith(t.stringLiteral(replacementString));
          this.changes++;
        },
      },

      // Phase 3: Cleanup - remove the proxy function after traversal
      Program: {
        exit() {
          if (proxyPath && proxyName) {
            logger('%s: removing proxy function declaration', proxyName);
            proxyPath.remove();
            this.changes++;
          }
        },
      },
    };
  },
} satisfies Transform<ProxyInlinerOptions>;
