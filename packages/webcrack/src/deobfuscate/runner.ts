import type * as t from '@babel/types';
import debug from 'debug';
import { applyTransforms, type TransformState } from '../ast-utils';
import { deobfuscatorRegistry } from './registry';
import type { DeobfuscatorContext, DeobfuscatorTarget } from './target';
import type { Sandbox } from './vm';

const logger = debug('webcrack:deobfuscate');

export interface DeobfuscateRunnerOptions {
  /** Target specification: id, 'auto', or boolean */
  target?: boolean | string | 'auto';
  /** Minimum confidence for auto-detection */
  threshold?: number;
  /** Sandbox for code execution */
  sandbox?: Sandbox;
}

/**
 * Resolves which target(s) to use based on options and detection
 */
async function resolveTarget(
  ast: t.File,
  options: DeobfuscateRunnerOptions,
): Promise<DeobfuscatorTarget | undefined> {
  const { target = true, threshold = 0.3 } = options;

  if (target === false) {
    return undefined;
  }

  // Explicit target by ID
  if (typeof target === 'string' && target !== 'auto') {
    const found = deobfuscatorRegistry.get(target);
    if (!found) {
      throw new Error(
        `Unknown deobfuscator target: '${target}'. ` +
          `Available targets: ${deobfuscatorRegistry.list().join(', ')}`,
      );
    }
    return found;
  }

  // Auto-detect or use default
  if (target === 'auto' || target === true) {
    const detections = await deobfuscatorRegistry.detect(ast);

    if (detections.length > 0 && detections[0].result.confidence >= threshold) {
      logger(
        `Auto-detected: ${detections[0].target.meta.id} (confidence: ${detections[0].result.confidence})`,
      );
      return detections[0].target;
    }

    // Fall back to default if no confident detection
    const defaultTarget = deobfuscatorRegistry.getDefault();
    if (defaultTarget) {
      logger(`Using default target: ${defaultTarget.meta.id}`);
      return defaultTarget;
    }

    logger('No target detected and no default set');
    return undefined;
  }

  return undefined;
}

/**
 * Run a single deobfuscator target
 */
async function runTarget(
  target: DeobfuscatorTarget,
  ast: t.File,
  state: TransformState,
  sandbox?: Sandbox,
): Promise<void> {
  const targetLogger = debug(`webcrack:deobfuscate:${target.meta.id}`);
  targetLogger(`Starting deobfuscation`);

  const context: DeobfuscatorContext = {
    ast,
    state,
    sandbox,
    log: (message, ...args) => targetLogger(message, ...args),
  };

  await target.deobfuscate.run(context);

  // Run post-transforms if any
  if (target.postTransforms?.length) {
    state.changes += applyTransforms(ast, target.postTransforms).changes;
  }

  targetLogger(`Completed with ${state.changes} changes`);
}

/**
 * Main deobfuscation entry point
 */
export async function runDeobfuscation(
  ast: t.File,
  options: DeobfuscateRunnerOptions,
): Promise<TransformState> {
  const state: TransformState = { changes: 0 };

  const target = await resolveTarget(ast, options);

  if (!target) {
    logger('No deobfuscation target to run');
    return state;
  }

  await runTarget(target, ast, state, options.sandbox);

  return state;
}
