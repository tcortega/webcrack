import { deobfuscatorRegistry } from '../registry';
import abba from './abba';
import obfuscatorIO from './obfuscator-io';

// Register all built-in targets
deobfuscatorRegistry.register(obfuscatorIO);
deobfuscatorRegistry.register(abba);

// Set the default target (used when auto-detection has no confident match)
deobfuscatorRegistry.setDefault('obfuscator.io');

// Export targets for direct access if needed
export { abba, obfuscatorIO };
