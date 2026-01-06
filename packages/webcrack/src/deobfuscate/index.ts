// Import targets to ensure they're registered
import './targets';

// Re-export types
export type {
  DeobfuscatorContext,
  DeobfuscatorTarget,
  DeobfuscatorTargetMeta,
  DetectionResult,
} from './target';

// Re-export registry
export { deobfuscatorRegistry, DeobfuscatorRegistry } from './registry';

// Re-export runner
export {
  runDeobfuscation,
  type DeobfuscateRunnerOptions,
} from './runner';

// Re-export sandbox utilities (for backward compatibility and external use)
export { createBrowserSandbox, createNodeSandbox, type Sandbox } from './vm';
