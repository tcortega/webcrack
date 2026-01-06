import * as t from '@babel/types';
import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:dead-code-removal');

export interface DeadCodeRemovalOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Checks if an initializer is safe to remove (has no side effects).
 *
 * Safe: Literals, functions, arrays, objects, identifiers, member expressions
 * Unsafe: Call expressions, new expressions (may have side effects)
 */
function isSafeInitializer(init: t.Expression | null | undefined): boolean {
  if (!init) return true; // No initializer (e.g., "var x;") is safe

  // Literals are always safe
  if (t.isLiteral(init)) return true;

  // Functions are safe (no side effect on declaration)
  if (t.isFunction(init)) return true;

  // Identifiers are safe (just a reference)
  if (t.isIdentifier(init)) return true;

  // Array expressions - check if all elements are safe
  if (t.isArrayExpression(init)) {
    return init.elements.every(
      (el) => el === null || (t.isExpression(el) && isSafeInitializer(el)),
    );
  }

  // Object expressions - check if all values are safe
  if (t.isObjectExpression(init)) {
    return init.properties.every((prop) => {
      if (t.isObjectProperty(prop)) {
        return t.isExpression(prop.value) && isSafeInitializer(prop.value);
      }
      // SpreadElement or ObjectMethod - be conservative
      return false;
    });
  }

  // Member expressions are usually safe (property access)
  if (t.isMemberExpression(init)) return true;

  // Binary/Unary expressions with safe operands
  if (t.isBinaryExpression(init)) {
    const leftSafe = t.isExpression(init.left) && isSafeInitializer(init.left);
    const rightSafe = t.isExpression(init.right) && isSafeInitializer(init.right);
    return leftSafe && rightSafe;
  }
  if (t.isUnaryExpression(init)) {
    return isSafeInitializer(init.argument);
  }

  // Conditional expressions - check all branches
  if (t.isConditionalExpression(init)) {
    return (
      isSafeInitializer(init.test) &&
      isSafeInitializer(init.consequent) &&
      isSafeInitializer(init.alternate)
    );
  }

  // Call expressions and new expressions are UNSAFE (side effects)
  // Anything else we're unsure about - be conservative
  return false;
}

/**
 * Removes unreferenced variable and function declarations.
 *
 * This transform dynamically analyzes scope bindings to find dead code
 * left behind by previous deobfuscation steps (string arrays, proxies,
 * loader functions, etc.).
 *
 * Safety: Only removes bindings with pure initializers (no side effects).
 */
export default {
  name: 'abba-dead-code-removal',
  tags: ['safe'],
  scope: true,
  visitor(options?: DeadCodeRemovalOptions) {
    const debugLog = options?.debug ?? (() => {});
    const removedBindings: string[] = [];

    return {
      Program: {
        exit(path) {
          // Refresh scope to ensure accurate reference counts
          path.scope.crawl();

          const bindings = path.scope.bindings;

          for (const name in bindings) {
            const binding = bindings[name];

            // Skip if the binding is referenced
            if (binding.referenced) {
              debugLog('dead-code: %s is referenced, keeping', name);
              continue;
            }

            const bindingPath = binding.path;
            const node = bindingPath.node;

            // Handle FunctionDeclaration
            if (t.isFunctionDeclaration(node)) {
              debugLog('dead-code: removing unreferenced function %s', name);
              bindingPath.remove();
              removedBindings.push(name);
              this.changes++;
              continue;
            }

            // Handle VariableDeclarator
            if (t.isVariableDeclarator(node)) {
              const init = node.init;

              if (isSafeInitializer(init)) {
                debugLog('dead-code: removing unreferenced variable %s', name);
                bindingPath.remove();
                removedBindings.push(name);
                this.changes++;
              } else {
                debugLog(
                  'dead-code: keeping %s (unsafe initializer: %s)',
                  name,
                  init?.type,
                );
              }
            }
          }

          if (removedBindings.length > 0) {
            logger('removed %d dead bindings: %s', removedBindings.length, removedBindings.join(', '));
          }
        },
      },

      // Clean up empty statements left by removals
      EmptyStatement(path) {
        path.remove();
        this.changes++;
      },
    };
  },
} satisfies Transform<DeadCodeRemovalOptions>;
