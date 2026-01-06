import type { Node, NodePath, Scope } from '@babel/traverse';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import debug from 'debug';
import type { Transform, TransformState } from '../../ast-utils';

const logger = debug('webcrack:abba:dead-code-removal');

export interface DeadCodeRemovalOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Checks if a reference path is still connected to the AST (not a "ghost" reference).
 */
function isValidReference(refPath: NodePath): boolean {
  try {
    return refPath.findParent((p) => p.isProgram()) !== null;
  } catch {
    return false;
  }
}

/**
 * Process bindings in a scope and remove unreferenced ones.
 */
function processScope(
  scope: Scope,
  state: TransformState,
  removedBindings: string[],
  debugLog: (msg: string, ...args: unknown[]) => void,
): boolean {
  let changed = false;
  const bindings = scope.bindings;

  for (const name in bindings) {
    const binding = bindings[name];

    // Filter out ghost references (stale refs from removed nodes still in Babel's cache)
    const validRefs = binding.referencePaths.filter(isValidReference);
    const validConstantViolations = binding.constantViolations.filter(isValidReference);
    const totalValidRefs = validRefs.length + validConstantViolations.length;

    if (totalValidRefs > 0) {
      continue;
    }

    const bindingPath = binding.path;
    const node = bindingPath.node;

    // FunctionDeclaration - always safe to remove
    if (t.isFunctionDeclaration(node)) {
      debugLog('dead-code: removing function %s', name);
      bindingPath.remove();
      removedBindings.push(name);
      changed = true;
      state.changes++;
      continue;
    }

    // VariableDeclarator - check if init is pure
    if (t.isVariableDeclarator(node)) {
      const initPath = bindingPath.get('init') as NodePath;
      const isPure = !initPath.node || initPath.isPure();

      if (isPure) {
        debugLog('dead-code: removing variable %s', name);
        bindingPath.remove();
        removedBindings.push(name);
        changed = true;
        state.changes++;
      }
    }
  }

  return changed;
}

/**
 * Removes unreferenced variable and function declarations.
 *
 * This transform handles "ghost references" - references from nodes that
 * were removed in previous transforms but still exist in Babel's scope cache.
 *
 * Uses run() instead of visitor() for full control over traversal and scope.
 * Uses multiple passes with fresh traversals to handle cascading removals.
 * Processes ALL scopes (program + nested function scopes).
 */
export default {
  name: 'abba-dead-code-removal',
  tags: ['safe'],
  scope: true,

  run(ast: Node, state: TransformState, options?: DeadCodeRemovalOptions) {
    const debugLog = options?.debug ?? (() => {});
    const removedBindings: string[] = [];
    let passCount = 0;
    let changed = true;

    // Keep running passes until nothing changes
    while (changed) {
      changed = false;
      passCount++;

      // Fresh traversal each pass - process ALL scopes
      traverse(ast, {
        Program: {
          exit(path) {
            path.scope.crawl();
            if (processScope(path.scope, state, removedBindings, debugLog)) {
              changed = true;
            }
          },
        },
        // Process function scopes (nested functions)
        'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression': {
          exit(path) {
            if (processScope(path.scope, state, removedBindings, debugLog)) {
              changed = true;
            }
          },
        },
      });
    }

    // Clean up empty variable declarations and statements
    traverse(ast, {
      VariableDeclaration(path) {
        if (path.node.declarations.length === 0) {
          path.remove();
          state.changes++;
        }
      },
      EmptyStatement(path) {
        path.remove();
        state.changes++;
      },
    });

    if (removedBindings.length > 0) {
      logger(
        'removed %d dead bindings in %d passes: %s',
        removedBindings.length,
        passCount,
        removedBindings.join(', '),
      );
    }
  },
} satisfies Transform<DeadCodeRemovalOptions>;
