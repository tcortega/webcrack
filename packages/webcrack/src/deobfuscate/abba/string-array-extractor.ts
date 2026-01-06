import generate from '@babel/generator';
import * as t from '@babel/types';
import debug from 'debug';
import type { Transform } from '../../ast-utils';

const logger = debug('webcrack:abba:string-array-extractor');

export interface StringArrayExtractorOptions {
  /** Debug logger function for verbose per-node logging */
  debug?: (message: string, ...args: unknown[]) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Proxy-Based Sandbox
// ═══════════════════════════════════════════════════════════════════════════

type CallableFunction = (...args: unknown[]) => unknown;

/**
 * Creates a recursive proxy that returns safe dummy values for any property access.
 * This allows obfuscated code to access any global without throwing ReferenceError.
 */
function createPermissiveProxy(): unknown {
  const handler: ProxyHandler<CallableFunction> = {
    get(_target, prop) {
      // Handle common properties with sensible defaults
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.toStringTag) return 'Object';
      if (prop === 'toString') return () => '';
      if (prop === 'valueOf') return () => 0;
      if (prop === 'length') return 0;
      if (prop === 'constructor') return Function;
      if (prop === 'prototype') return {};
      // For everything else, return another proxy (allows infinite chaining)
      return createPermissiveProxy();
    },
    apply() {
      // Function calls return a proxy too (allows method chaining)
      return createPermissiveProxy();
    },
    construct() {
      // new SomeProxy() returns a proxy
      return createPermissiveProxy() as object;
    },
    has() {
      // `'prop' in obj` always returns true
      return true;
    },
    set() {
      // Allow property assignments (they do nothing)
      return true;
    },
  };

  // Use a function as base so the proxy is callable
  return new Proxy(function () {}, handler);
}

/**
 * Wraps an object with a Proxy that returns permissive proxies for missing properties.
 * This allows accessing mocked properties normally, but unknown properties don't crash.
 */
function wrapWithFallback(obj: Record<string, unknown>): unknown {
  return new Proxy(obj, {
    get(target, prop) {
      if (prop in target) {
        const value = target[prop as string];
        // Recursively wrap nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return wrapWithFallback(value as Record<string, unknown>);
        }
        return value;
      }
      // Unknown property → permissive proxy
      return createPermissiveProxy();
    },
    has() {
      return true;
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
}

function createSandbox(): Record<string, unknown> {
  const baseSandbox: Record<string, unknown> = {
    // ═══════════════════════════════════════════════════════════════
    // Essential JS globals (MUST work correctly for decoding)
    // ═══════════════════════════════════════════════════════════════
    decodeURIComponent,
    unescape,
    escape,
    encodeURIComponent,
    encodeURI,
    decodeURI,
    String,
    Array,
    Object,
    RegExp,
    Function,
    Math,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    Boolean,
    Number,
    Date,
    JSON,
    Error,
    TypeError,
    ReferenceError,
    SyntaxError,
    RangeError,
    URIError,
    EvalError,
    ArrayBuffer,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    Proxy,
    Reflect,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),

    // ═══════════════════════════════════════════════════════════════
    // Sensible browser mocks (may affect key derivation)
    // ═══════════════════════════════════════════════════════════════
    window: {
      location: {
        href: 'http://localhost/',
        hostname: 'localhost',
        pathname: '/',
        protocol: 'http:',
        host: 'localhost',
        origin: 'http://localhost',
      },
    },
    document: {
      location: {
        href: 'http://localhost/',
        hostname: 'localhost',
        pathname: '/',
        protocol: 'http:',
        host: 'localhost',
        origin: 'http://localhost',
      },
      domain: 'localhost',
      URL: 'http://localhost/',
      documentURI: 'http://localhost/',
      referrer: '',
      cookie: '',
      title: '',
      createElement: () => ({}),
      getElementById: () => null,
      getElementsByTagName: () => [],
      getElementsByClassName: () => [],
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    navigator: {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      language: 'en-US',
      languages: ['en-US', 'en'],
      cookieEnabled: true,
      onLine: true,
      hardwareConcurrency: 8,
    },
    location: {
      href: 'http://localhost/',
      hostname: 'localhost',
      pathname: '/',
      protocol: 'http:',
      host: 'localhost',
      origin: 'http://localhost',
    },
    self: {}, // Will be set to sandbox itself
    globalThis: {}, // Will be set to sandbox itself

    // ═══════════════════════════════════════════════════════════════
    // Console (stub for debugging calls in obfuscated code)
    // ═══════════════════════════════════════════════════════════════
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {},
      trace: () => {},
      dir: () => {},
      table: () => {},
    },

    // ═══════════════════════════════════════════════════════════════
    // Timing functions (return consistent values)
    // ═══════════════════════════════════════════════════════════════
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 0;
    },
    cancelAnimationFrame: () => {},
  };

  // Set self-references
  baseSandbox.self = baseSandbox;
  baseSandbox.globalThis = baseSandbox;

  // Wrap everything with Proxy fallback
  return wrapWithFallback(baseSandbox) as Record<string, unknown>;
}

/**
 * Execute code in a sandboxed environment using Function constructor.
 * Works in both Node.js and browser (unlike vm.runInNewContext).
 */
function executeInSandbox(code: string, sandbox: Record<string, unknown>): unknown {
  // Get all sandbox keys and values
  const keys = Object.keys(sandbox);
  const values = keys.map((k) => sandbox[k]);

  // Create a function with sandbox variables as parameters
  // The function body returns the result of evaluating the code
  // We use non-strict mode here so that `this` defaults to the global object (our sandbox)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...keys, `return (${code})`);

  // Execute with sandbox as `this` context, so code accessing `this` gets the sandbox
  return fn.apply(sandbox, values);
}

// ═══════════════════════════════════════════════════════════════════════════
// Transform
// ═══════════════════════════════════════════════════════════════════════════

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

          const sandbox = createSandbox();

          // Add the variable name to sandbox - obfuscated code often references itself
          sandbox[varName] = undefined;

          debugLog('%s: sandbox keys = %s', varName, Object.keys(sandbox).join(', '));

          // Execute in sandboxed environment (works in both Node.js and browser)
          const result: unknown = executeInSandbox(code, sandbox);

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
