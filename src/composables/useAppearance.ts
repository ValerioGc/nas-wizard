import { onBeforeUnmount, ref, watchEffect, type Ref } from 'vue';
import type { Theme } from '@/types/types';

/**
 * Applies the theme chosen in the wizard to the page, following the system when it says so.
 */
export function useAppearance(preferred: Ref<Theme>) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const dark = ref(media.matches);

  const update = () => {
    dark.value = media.matches;
  };

  media.addEventListener('change', update);

  watchEffect(() => {
    const automatic = dark.value ? 'dark' : 'light';
    document.documentElement.dataset.theme =
      preferred.value === 'system' ? automatic : preferred.value;
  });

  onBeforeUnmount(() => media.removeEventListener('change', update));
}
