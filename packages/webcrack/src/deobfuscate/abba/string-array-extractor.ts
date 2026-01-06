import generate from '@babel/generator';
import * as t from '@babel/types';
import debug from 'debug';
import { runInNewContext } from 'vm';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:string-array-extractor');

export interface StringArrayExtractorOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

export default {
  name: 'abba-string-array-extractor',
  tags: ['unsafe'],
  visitor(options?: StringArrayExtractorOptions) {
    const debugLog = options?.debug ?? (() => {});

    return {
      VariableDeclarator(path) {
        const { init, id } = path.node;

        // Safety check for non-identifier patterns
        if (!t.isIdentifier(id)) {
          debugLog('Skipped non-identifier: %s', id?.type);
          return;
        }

        const varName = id.name;
        debugLog('%s: visiting', varName);

        if (!init) {
          debugLog('%s: no init value', varName);
          return;
        }

        debugLog('%s: init type = %s', varName, init.type);

        // Check 1: Is it a CallExpression?
        if (!t.isCallExpression(init)) {
          debugLog('%s: not a CallExpression', varName);
          return;
        }

        debugLog('%s: callee type = %s', varName, init.callee.type);

        // Check 2: Is the callee a FunctionExpression (IIFE)?
        if (!t.isFunctionExpression(init.callee)) {
          logger('%s: skipped - callee is not FunctionExpression', varName);
          return;
        }

        // Check 3: Does it have a string payload argument?
        const hasStringPayload = init.arguments.some((arg) =>
          t.isStringLiteral(arg),
        );
        debugLog(
          '%s: hasStringPayload = %s (args: %s)',
          varName,
          hasStringPayload,
          init.arguments.map((a) => a.type).join(', '),
        );

        if (!hasStringPayload) {
          logger('%s: skipped - no StringLiteral argument found', varName);
          return;
        }

        logger('%s: found IIFE with string payload, executing...', varName);
        debugLog('%s: generating code for VM execution', varName);

        try {
          const code = generate(init).code;
          debugLog('%s: code snippet = %s...', varName, code.substring(0, 80));

          const sandbox = {
            // Standard JS Globals
            decodeURIComponent: decodeURIComponent,
            unescape: unescape,
            String: String,
            Array: Array,
            Object: Object,
            RegExp: RegExp,
            Function: Function,
            Math: Math,
            parseInt: parseInt,

            // Mock Browser Globals (The Fix)
            window: {},
            document: {
              // Mock common properties obfuscators check
              location: { href: 'http://localhost' },
              domain: 'localhost',
              createElement: () => ({}), // Dummy element
            },
            navigator: {
              userAgent: 'Node.js',
            },

            // Handle 'this' being used in the IIFE arguments
            // (The code passes 'this' as the first arg: }(this, '...'))
            // In the VM, 'this' is usually the sandbox itself, but we can explicit define it if needed.
          };

          // 4. Execute
          const result: unknown = runInNewContext(code, sandbox);

          debugLog('%s: VM result type = %s', varName, typeof result);

          if (!Array.isArray(result)) {
            logger('%s: VM returned non-array: %s', varName, typeof result);
            return;
          }

          logger('%s: extracted %d strings', varName, result.length);
          debugLog(
            '%s: first few strings = %s',
            varName,
            result.slice(0, 3).map(String).join(', '),
          );

          const staticArray = t.arrayExpression(
            result.map((item) => t.stringLiteral(String(item))),
          );

          path.node.init = staticArray;
          this.changes++;
        } catch (error) {
          logger('%s: VM execution failed - %O', varName, error);
          debugLog('%s: error details - %O', varName, error);
        }
      },
    };
  },
} satisfies Transform<StringArrayExtractorOptions>;
