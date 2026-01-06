import type * as t from '@babel/types';
import debug from 'debug';
import type { DeobfuscatorTarget, DetectionResult } from './target';

const logger = debug('webcrack:registry');

/**
 * Registry for deobfuscator targets
 */
class DeobfuscatorRegistry {
  private targets = new Map<string, DeobfuscatorTarget>();
  private defaultTargetId: string | null = null;

  /**
   * Register a deobfuscator target
   */
  register(target: DeobfuscatorTarget): void {
    if (this.targets.has(target.meta.id)) {
      logger(`Overwriting existing target: ${target.meta.id}`);
    }
    this.targets.set(target.meta.id, target);
    logger(`Registered target: ${target.meta.id}`);
  }

  /**
   * Unregister a target by ID
   */
  unregister(id: string): boolean {
    return this.targets.delete(id);
  }

  /**
   * Get a target by ID
   */
  get(id: string): DeobfuscatorTarget | undefined {
    return this.targets.get(id);
  }

  /**
   * Get all registered targets
   */
  getAll(): DeobfuscatorTarget[] {
    return Array.from(this.targets.values());
  }

  /**
   * List all registered target IDs
   */
  list(): string[] {
    return Array.from(this.targets.keys());
  }

  /**
   * Check if a target exists
   */
  has(id: string): boolean {
    return this.targets.has(id);
  }

  /**
   * Set the default target ID
   */
  setDefault(id: string): void {
    if (!this.targets.has(id)) {
      throw new Error(`Target '${id}' not found in registry`);
    }
    this.defaultTargetId = id;
  }

  /**
   * Get the default target
   */
  getDefault(): DeobfuscatorTarget | undefined {
    return this.defaultTargetId
      ? this.targets.get(this.defaultTargetId)
      : undefined;
  }

  /**
   * Auto-detect which target should be used for the given AST.
   * Returns targets sorted by confidence (highest first).
   */
  async detect(
    ast: t.File,
  ): Promise<Array<{ target: DeobfuscatorTarget; result: DetectionResult }>> {
    const results: Array<{
      target: DeobfuscatorTarget;
      result: DetectionResult;
    }> = [];

    for (const target of this.targets.values()) {
      if (target.detect) {
        try {
          const result = await target.detect(ast);
          if (result.confidence > 0) {
            results.push({ target, result });
          }
        } catch (error) {
          logger(`Detection failed for ${target.meta.id}:`, error);
        }
      }
    }

    return results.sort((a, b) => b.result.confidence - a.result.confidence);
  }
}

// Singleton instance
export const deobfuscatorRegistry = new DeobfuscatorRegistry();

// Export class for type usage
export { DeobfuscatorRegistry };
