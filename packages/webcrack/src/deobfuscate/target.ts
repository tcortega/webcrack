import type * as t from '@babel/types';
import type { Transform, TransformState } from '../ast-utils';
import type { Sandbox } from './vm';

/**
 * Metadata about a deobfuscator target
 */
export interface DeobfuscatorTargetMeta {
  /** Unique identifier for the target (e.g., 'obfuscator.io', 'cloudflare') */
  id: string;
  /** Human-readable name for display */
  name: string;
  /** Description of what this target handles */
  description?: string;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Detection result from a target's detect() method
 */
export interface DetectionResult {
  /** Confidence score from 0 to 1 */
  confidence: number;
  /** Optional details about what patterns were detected */
  details?: Record<string, unknown>;
}

/**
 * Context provided to the deobfuscator during execution
 */
export interface DeobfuscatorContext {
  ast: t.File;
  state: TransformState;
  sandbox?: Sandbox;
  /** Logger function scoped to this target (info level) */
  log: (message: string, ...args: unknown[]) => void;
  /** Debug logger for verbose per-node logging (only active when debugLogging is enabled) */
  debug: (message: string, ...args: unknown[]) => void;
}

/**
 * Core interface that all deobfuscator targets must implement
 */
export interface DeobfuscatorTarget {
  /** Metadata about this target */
  meta: DeobfuscatorTargetMeta;

  /**
   * Optional detection function to identify if code was obfuscated by this tool.
   * Returns a confidence score (0-1) indicating likelihood.
   * Used for auto-detection when no target is explicitly specified.
   */
  detect?(ast: t.File): DetectionResult | Promise<DetectionResult>;

  /**
   * The main deobfuscation logic.
   */
  deobfuscate: {
    run(context: DeobfuscatorContext): Promise<void> | void;
  };

  /**
   * Optional transforms to run after the main deobfuscation.
   * Common cleanup transforms that are target-specific.
   */
  postTransforms?: Transform[];
}
