<script setup lang="ts">

import { onMounted } from 'vue';
import WizardView from '@/views/WizardView.vue';

// Replace an old cached gateway redirect on `/` before this installation hands the port over.
// A reload bypasses the stored redirect and refreshes this URL in the browser's HTTP cache.
onMounted(async () => {
  try {
    await fetch('/', {
      cache: 'reload',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // The page is already open
  }
});

</script>

<template>
  <WizardView />
</template>
