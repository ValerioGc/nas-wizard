import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import type { UserConfig } from 'vite';

import combineSelectors from 'postcss-combine-duplicated-selectors';
import purgecss from '@fullhuman/postcss-purgecss';
import cssnano from 'cssnano';

export const commonConfig: UserConfig = {
  plugins: [vue()],
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use '@/styles/global' as *;\n`,
      },
    },

    postcss: {
      plugins: [
        combineSelectors({ removeDuplicatedProperties: true }),
        purgecss({
          content: ['./index.html', './src/**/*.vue', './src/**/*.ts', './src/**/*.scss'],
          safelist: {
            standard: [/^v-/, /^dark/],
          },
          defaultExtractor: (content) => content.match(/[\w-/:]+(?<!:)/g) ?? [],
        }),
        cssnano({ preset: 'default' }),
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./src/tests', import.meta.url)),
      '@scripts': fileURLToPath(new URL('./scripts', import.meta.url)),
    },
  },
};
