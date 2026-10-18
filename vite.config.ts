import { defineConfig } from 'vite';
import { commonConfig } from './vite.config.common.ts';
import vue from '@vitejs/plugin-vue';
import { stripTestIds, stripTestIdsNodeTransform } from './scripts/build/strip-test-ids.ts';

const productionPlugins = [
  vue({
    template: {
      compilerOptions: {
        nodeTransforms: [stripTestIdsNodeTransform],
      },
    },
  }),
  stripTestIds(),
];

export default defineConfig(({ command }) => ({
  ...commonConfig,
  plugins: command === 'build' ? productionPlugins : commonConfig.plugins,
  server: {
    ...(commonConfig.server ?? {}),

    watch: { ignored: ['**/target/**', '**/backend/data/**', '**/coverage/**'] },
    proxy: {
      '/api': process.env.NAS_WIZARD_TARGET ?? 'http://127.0.0.1:3006',
    },
  },
}));
