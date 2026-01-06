import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const watch = args.length > 0 && /^(?:--watch|-w)$/i.test(args[0]);

/**
 * Fixes https://github.com/babel/babel/issues/15269
 * @type {esbuild.Plugin}
 */
const babelImportPlugin = {
  name: 'babel-import',
  setup: (build) => {
    build.onResolve({ filter: /^@babel\/(traverse|generator)$/ }, (args) => {
      return {
        path: args.path,
        namespace: 'babel-import',
      };
    });

    build.onLoad({ filter: /.*/, namespace: 'babel-import' }, (args) => {
      const pkgPath = require.resolve(`${args.path}/package.json`);
      const pkgDir = dirname(pkgPath);
      return {
        resolveDir: pkgDir,
        contents: `import module from './lib/index.js';
          export default module.default ?? module;
          export * from './lib/index.js';`,
      };
    });
  },
};

/**
 * @type {esbuild.BuildOptions[]}
 */
const configs = [
  {
    entryPoints: ['src/index.ts'],
  },
  {
    entryPoints: [
      {
        in: 'src/cjs-wrapper.ts',
        out: 'index',
      },
    ],
    outExtension: { '.js': '.cjs' },
    format: 'cjs',
    bundle: false,
  },
  {
    entryPoints: ['src/cli.ts'],
    bundle: false,
  },
];

for (const config of configs) {
  const ctx = await esbuild.context({
    bundle: true,
    format: 'esm',
    platform: 'node',
    outdir: 'dist',
    sourcemap: true,
    packages: 'external',
    plugins: [babelImportPlugin],
    logLevel: 'info',
    ...config,
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}
