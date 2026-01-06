import * as t from '@babel/types';
import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:member-expression-simplifier');

export interface MemberExpressionSimplifierOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Valid JavaScript identifier pattern.
 * Must start with letter, $, or _, followed by letters, numbers, $, or _.
 */
const VALID_IDENTIFIER_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Converts bracket notation member expressions to dot notation where valid.
 *
 * Example transformations:
 * - `Object["defineProperty"]` → `Object.defineProperty`
 * - `window["document"]` → `window.document`
 *
 * Preserved (invalid identifiers):
 * - `data["1.1.2"]` → unchanged (starts with number, contains dot)
 * - `headers["content-type"]` → unchanged (contains hyphen)
 * - `obj["class"]` → unchanged (reserved keyword)
 */
export default {
  name: 'abba-member-expression-simplifier',
  tags: ['safe'],
  visitor(options?: MemberExpressionSimplifierOptions) {
    const debugLog = options?.debug ?? (() => {});
    let totalSimplified = 0;

    return {
      MemberExpression(path) {
        const { node } = path;

        // 1. Must be computed (bracket notation)
        if (!node.computed) return;

        // 2. Property must be a StringLiteral
        if (!t.isStringLiteral(node.property)) return;

        const propName = node.property.value;

        // 3. Must be a valid JavaScript identifier
        if (!VALID_IDENTIFIER_REGEX.test(propName)) {
          debugLog(
            'member-simplifier: skipping "%s" - not a valid identifier',
            propName,
          );
          return;
        }

        // 4. Skip reserved keywords to be safe
        // Using Babel's built-in check which is more comprehensive
        if (!t.isValidIdentifier(propName, false)) {
          debugLog(
            'member-simplifier: skipping "%s" - reserved keyword or invalid',
            propName,
          );
          return;
        }

        // 5. Transform: bracket notation → dot notation
        node.computed = false;
        node.property = t.identifier(propName);
        this.changes++;
        totalSimplified++;

        debugLog('member-simplifier: simplified ["' + propName + '"] → .' + propName);
      },

      Program: {
        exit() {
          if (totalSimplified > 0) {
            logger('simplified %d member expressions', totalSimplified);
          }
        },
      },
    };
  },
} satisfies Transform<MemberExpressionSimplifierOptions>;
