import {
  applyTransform,
  applyTransformAsync,
  applyTransforms,
} from '../../ast-utils';
import mergeStrings from '../../unminify/transforms/merge-strings';
import { findArrayRotator } from '../array-rotator';
import controlFlowObject from '../control-flow-object';
import controlFlowSwitch from '../control-flow-switch';
import deadCode from '../dead-code';
import { findDecoders } from '../decoder';
import inlineDecodedStrings from '../inline-decoded-strings';
import inlineDecoderWrappers from '../inline-decoder-wrappers';
import inlineObjectProps from '../inline-object-props';
import { findStringArray } from '../string-array';
import type { DeobfuscatorTarget } from '../target';
import { VMDecoder } from '../vm';

const obfuscatorIOTarget: DeobfuscatorTarget = {
  meta: {
    id: 'obfuscator.io',
    name: 'Obfuscator.io / javascript-obfuscator',
    description:
      'Deobfuscates code obfuscated with obfuscator.io or javascript-obfuscator',
    tags: ['string-array', 'control-flow', 'dead-code'],
  },

  detect(ast) {
    let confidence = 0;
    const details: Record<string, boolean> = {};

    // Check for string array pattern (strong indicator)
    const stringArray = findStringArray(ast);
    if (stringArray) {
      confidence += 0.5;
      details.stringArray = true;
    }

    // Could add more heuristics in the future:
    // - Check for characteristic function naming patterns (_0x...)
    // - Check for control flow switch patterns
    // - Check for self-defending code patterns

    return { confidence: Math.min(confidence, 1), details };
  },

  deobfuscate: {
    async run(context) {
      const { ast, state, sandbox, log } = context;
      if (!sandbox) return;

      const stringArray = findStringArray(ast);
      log(
        stringArray
          ? `String Array: ${stringArray.originalName}, length ${stringArray.length}`
          : 'String Array: no',
      );
      if (!stringArray) return;

      const rotator = findArrayRotator(stringArray);
      log(`String Array Rotate: ${rotator ? 'yes' : 'no'}`);

      const decoders = findDecoders(stringArray);
      log(
        `String Array Decoders: ${decoders
          .map((d) => d.originalName)
          .join(', ')}`,
      );

      state.changes += applyTransform(ast, inlineObjectProps).changes;

      for (const decoder of decoders) {
        state.changes += applyTransform(
          ast,
          inlineDecoderWrappers,
          decoder.path,
        ).changes;
      }

      const vm = new VMDecoder(sandbox, stringArray, decoders, rotator);
      state.changes += (
        await applyTransformAsync(ast, inlineDecodedStrings, { vm })
      ).changes;

      if (decoders.length > 0) {
        stringArray.path.remove();
        rotator?.remove();
        decoders.forEach((decoder) => decoder.path.remove());
        state.changes += 2 + decoders.length;
      }

      state.changes += applyTransforms(
        ast,
        [mergeStrings, deadCode, controlFlowObject, controlFlowSwitch],
        { noScope: true },
      ).changes;
    },
  },
};

export default obfuscatorIOTarget;
