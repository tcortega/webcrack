import config from '@webcrack/eslint-config';

/**
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['tmp', '**/test/samples'],
  },
];
