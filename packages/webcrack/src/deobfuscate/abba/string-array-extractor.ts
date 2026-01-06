import generate from '@babel/generator';
import * as t from '@babel/types';
import debug from 'debug';
import { runInNewContext } from 'vm';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:string-array-extractor');

export default {
  name: 'abba-string-array-extractor',
  tags: ['unsafe'],
  visitor() {
    return {
      VariableDeclarator(path) {
        const { init, id } = path.node;
        const varName = t.isIdentifier(id) ? id.name : '<unknown>';

        // Check 1: Is it a CallExpression?
        if (!t.isCallExpression(init)) return;

        // Check 2: Is the callee a FunctionExpression (IIFE)?
        if (!t.isFunctionExpression(init.callee)) {
          logger('%s: skipped - callee is not FunctionExpression', varName);
          return;
        }

        // Check 3: Does it have a string payload argument?
        const hasStringPayload = init.arguments.some((arg) =>
          t.isStringLiteral(arg),
        );
        if (!hasStringPayload) {
          logger('%s: skipped - no StringLiteral argument found', varName);
          return;
        }

        logger('%s: found IIFE with string payload, executing...', varName);

        try {
          const code = generate(init).code;
          const result: unknown = runInNewContext(code, {
            decodeURIComponent,
            unescape,
            String,
            Array,
            Object,
            RegExp,
            window: {},
          });

          if (!Array.isArray(result)) {
            logger('%s: VM returned non-array: %s', varName, typeof result);
            return;
          }

          logger('%s: extracted %d strings', varName, result.length);

          const staticArray = t.arrayExpression(
            result.map((item) => t.stringLiteral(String(item))),
          );

          path.node.init = staticArray;
          this.changes++;
        } catch (error) {
          logger('%s: VM execution failed - %O', varName, error);
        }
      },
    };
  },
} satisfies Transform;
