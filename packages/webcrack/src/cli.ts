#!/usr/bin/env node

import { program } from 'commander';
import debug from 'debug';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as url from 'node:url';
import { deobfuscatorRegistry } from './deobfuscate/registry.js';
// Import targets to ensure they're registered
import './deobfuscate/targets/index.js';
import { webcrack } from './index.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const { version, description } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string; description: string };

debug.enable('webcrack:*');

interface Options {
  force?: boolean;
  output?: string;
  mangle?: boolean;
  jsx: boolean;
  unpack: boolean;
  deobfuscate: boolean;
  deobfuscator?: string;
  listDeobfuscators?: boolean;
  unminify: boolean;
}

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

program
  .version(version)
  .description(description)
  .option('-o, --output <path>', 'output directory for bundled files')
  .option('-f, --force', 'overwrite output directory')
  .option('-m, --mangle', 'mangle variable names')
  .option('--no-jsx', 'do not decompile JSX')
  .option('--no-unpack', 'do not extract modules from the bundle')
  .option('--no-deobfuscate', 'do not deobfuscate the code')
  .option(
    '-d, --deobfuscator <target>',
    'deobfuscator target to use (e.g., obfuscator.io, auto)',
  )
  .option('--list-deobfuscators', 'list available deobfuscator targets')
  .option('--no-unminify', 'do not unminify the code')
  .argument('[file]', 'input file, defaults to stdin')
  .action(async (input: string | undefined) => {
    const opts = program.opts<Options>();

    // Handle --list-deobfuscators
    if (opts.listDeobfuscators) {
      console.log('Available deobfuscator targets:\n');
      for (const target of deobfuscatorRegistry.getAll()) {
        console.log(`  ${target.meta.id}`);
        console.log(`    Name: ${target.meta.name}`);
        if (target.meta.description) {
          console.log(`    Description: ${target.meta.description}`);
        }
        console.log();
      }
      return;
    }

    const { output, force, deobfuscator, listDeobfuscators, ...options } = opts;
    const code = await (input ? readFile(input, 'utf8') : readStdin());

    if (output) {
      if (force || !existsSync(output)) {
        await rm(output, { recursive: true, force: true });
      } else {
        program.error('output directory already exists');
      }
    }

    // Convert deobfuscator option to deobfuscate format
    const deobfuscateOption = deobfuscator ? deobfuscator : options.deobfuscate;

    const result = await webcrack(code, {
      ...options,
      deobfuscate: deobfuscateOption,
    });

    if (output) {
      await result.save(output);
    } else {
      console.log(result.code);
      if (result.bundle) {
        debug('webcrack:unpack')(
          'Modules are not displayed in the terminal. Use the --output option to save them to a directory.',
        );
      }
    }
  })
  .parse();
