import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:string-normalizer');

export interface StringNormalizerOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Normalizes string and numeric literals by removing formatting metadata.
 *
 * Babel stores the original formatting in the `extra` property:
 * - Hex escapes: '\x66\x75\x6e\x63\x74\x69\x6f\x6e' → 'function'
 * - Unicode escapes: '\u0041' → 'A'
 * - Hex numbers: 0x1a → 26
 * - Octal numbers: 0o32 → 26
 *
 * Deleting `extra` forces the code generator to use the cleanest representation.
 */
export default {
  name: 'abba-string-normalizer',
  tags: ['safe'],
  visitor(options?: StringNormalizerOptions) {
    const debugLog = options?.debug ?? (() => {});
    let stringsNormalized = 0;
    let numbersNormalized = 0;

    return {
      StringLiteral(path) {
        if (path.node.extra) {
          debugLog(
            'string-normalizer: normalizing string "%s"',
            path.node.value.substring(0, 30),
          );
          delete path.node.extra;
          stringsNormalized++;
          this.changes++;
        }
      },

      NumericLiteral(path) {
        if (path.node.extra) {
          debugLog('string-normalizer: normalizing number %d', path.node.value);
          delete path.node.extra;
          numbersNormalized++;
          this.changes++;
        }
      },

      Program: {
        exit() {
          if (stringsNormalized > 0 || numbersNormalized > 0) {
            logger(
              'normalized %d strings and %d numbers',
              stringsNormalized,
              numbersNormalized,
            );
          }
        },
      },
    };
  },
} satisfies Transform<StringNormalizerOptions>;
