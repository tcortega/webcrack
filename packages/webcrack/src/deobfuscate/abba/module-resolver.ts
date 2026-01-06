import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:module-resolver');

export interface ModuleResolverOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Resolves custom module loader calls into direct property assignments.
 *
 * Target pattern (loader function):
 * ```javascript
 * function M(j, k) {
 *     var m = jb;  // Registry reference
 *     // ... splits 'j' by '.' and assigns k() result ...
 * }
 * ```
 *
 * Target pattern (usage):
 * ```javascript
 * M("Promise", function(currentValue) { return NewPromise; });
 * M("A.B", function(x) { ... });
 * ```
 *
 * Transformed output:
 * ```javascript
 * jb["Promise"] = (function(currentValue) { return NewPromise; })(jb["Promise"]);
 * jb["A"]["B"] = (function(x) { ... })(jb["A"]["B"]);
 * ```
 */
export default {
  name: 'abba-module-resolver',
  tags: ['safe'],
  scope: true,
  visitor(options?: ModuleResolverOptions) {
    const debugLog = options?.debug ?? (() => {});

    let loaderName = '';
    let loaderPath: NodePath<t.FunctionDeclaration> | null = null;
    let registryName = '';

    /**
     * Builds a nested member expression from path parts.
     * e.g., ["A", "B", "C"] with registry "jb" → jb["A"]["B"]["C"]
     */
    function buildMemberExpression(parts: string[]): t.MemberExpression {
      let expr: t.Expression = t.identifier(registryName);
      for (const part of parts) {
        expr = t.memberExpression(expr, t.stringLiteral(part), true);
      }
      return expr as t.MemberExpression;
    }

    return {
      // Phase 1: Identify the loader function and registry
      FunctionDeclaration(path) {
        if (loaderName) return; // Already found

        const { node } = path;
        if (!node.id) return;

        // Heuristic: 2 parameters
        if (node.params.length !== 2) return;

        const funcName = node.id.name;
        debugLog('module-resolver: examining function %s', funcName);

        // Heuristic: body contains split('.') pattern
        const bodyCode = JSON.stringify(node.body);
        if (!bodyCode.includes('split')) {
          debugLog('module-resolver: %s - no split() found', funcName);
          return;
        }

        // Find the registry variable - look for pattern: var m = externalIdentifier
        let detectedRegistry = '';

        path.traverse({
          VariableDeclarator(innerPath) {
            if (detectedRegistry) return; // Already found

            const { id, init } = innerPath.node;
            if (!t.isIdentifier(id) || !t.isIdentifier(init)) return;

            // Check if init references an external variable (not a parameter)
            const paramNames = node.params
              .filter((p): p is t.Identifier => t.isIdentifier(p))
              .map((p) => p.name);

            if (!paramNames.includes(init.name)) {
              // This is likely the registry reference
              detectedRegistry = init.name;
              debugLog(
                'module-resolver: %s - found registry reference: %s',
                funcName,
                detectedRegistry,
              );
            }
          },
        });

        if (!detectedRegistry) {
          debugLog('module-resolver: %s - no registry variable found', funcName);
          return;
        }

        // Verify the registry exists in scope
        const binding = path.scope.getBinding(detectedRegistry);
        if (!binding) {
          debugLog(
            'module-resolver: %s - registry %s not found in scope',
            funcName,
            detectedRegistry,
          );
          return;
        }

        // Success - capture loader info
        loaderName = funcName;
        loaderPath = path;
        registryName = detectedRegistry;

        logger('identified loader %s with registry %s', loaderName, registryName);
      },

      // Phase 2: Transform loader calls
      CallExpression: {
        exit(path) {
          if (!loaderName || !registryName) return;

          const { callee, arguments: args } = path.node;

          // Check if this is a call to the loader function
          if (!t.isIdentifier(callee) || callee.name !== loaderName) return;

          // Need at least 2 arguments: module path and factory function
          if (args.length < 2) {
            debugLog('module-resolver: %s call has insufficient args', loaderName);
            return;
          }

          const moduleNameNode = args[0];
          const factoryNode = args[1];

          // Module name must be a string literal
          if (!t.isStringLiteral(moduleNameNode)) {
            debugLog(
              'module-resolver: %s call has non-string module name: %s',
              loaderName,
              moduleNameNode.type,
            );
            return;
          }

          // Factory must be a function
          if (!t.isFunctionExpression(factoryNode) && !t.isArrowFunctionExpression(factoryNode)) {
            debugLog(
              'module-resolver: %s call has non-function factory: %s',
              loaderName,
              factoryNode.type,
            );
            return;
          }

          const modulePath = moduleNameNode.value;
          const pathParts = modulePath.split('.');

          debugLog('module-resolver: transforming %s("%s")', loaderName, modulePath);

          // Build: registry["A"]["B"]["C"]
          const memberExpr = buildMemberExpression(pathParts);

          // Build: (factory)(currentValue)
          // The factory receives the current value at that path
          const iife = t.callExpression(factoryNode, [
            // Clone the member expression for the argument
            buildMemberExpression(pathParts),
          ]);

          // Build: registry["A"]["B"]["C"] = (factory)(registry["A"]["B"]["C"])
          const assignment = t.assignmentExpression('=', memberExpr, iife);

          path.replaceWith(assignment);
          this.changes++;

          debugLog(
            'module-resolver: %s("%s") → %s["%s"] = ...',
            loaderName,
            modulePath,
            registryName,
            pathParts.join('"]["'),
          );
        },
      },

      // Phase 3: Cleanup - optionally remove the loader function
      Program: {
        exit() {
          if (loaderPath && loaderName) {
            logger('%s: removing loader function declaration', loaderName);
            loaderPath.remove();
            this.changes++;
          }
        },
      },
    };
  },
} satisfies Transform<ModuleResolverOptions>;
