<script setup lang="ts">

import { computed, nextTick, ref, watch } from 'vue';
import { t } from '@/i18n';
import { request } from '@/api/client';
import { usePolling } from '@/composables/usePolling';
import { failureMessage } from '@/utils/failureMessage';
import type { StepId, WizardState } from '@/types/types';

import CommonIcon from '@/components/commons/CommonIcon.vue';
import CommonSpinner from '@/components/commons/CommonSpinner.vue';
import WizardCertificate from '@/components/steps/WizardCertificate.vue';
import errorIcon from '@/assets/icons/status/error.svg';
import successIcon from '@/assets/icons/status/success.svg';

interface Props {
  initial: WizardState;
}

const props = defineProps<Props>();

const POLL_INTERVAL = 2000;
const LABELS: Record<StepId, string> = {
  download_gateway: 'install.steps.downloadGateway',
  download_ui: 'install.steps.downloadUi',
  install_gateway: 'install.steps.installGateway',
  install_ui: 'install.steps.installUi',
  configure: 'install.steps.configure',
  disks: 'install.steps.disks',
  account: 'install.steps.account',
  certificate: 'install.steps.certificate',
  complete: 'install.steps.complete',
  handover: 'install.steps.handover',
};

const ICONS: Record<'done' | 'failed', string> = {
  done: successIcon,
  failed: errorIcon,
};

const STATES: Record<'done' | 'failed', string> = {
  done: 'install.states.done',
  failed: 'install.states.failed',
};

const state = ref<WizardState>(props.initial);
const root = ref<HTMLElement | null>(null);
const retrying = ref(false);
const error = ref('');

const visibleSteps = computed(() => {
  const steps = state.value.steps;
  const current = steps.findIndex((step) => step.state !== 'done');
  return current === -1 ? steps : steps.slice(0, current + 1);
});

const handingOver = computed(() => state.value.phase === 'done' && !state.value.simulated);

/**
 * Waits for the gateway to serve the NAS, then opens login on the same origin. Keeping the browser's
 * port preserves forwarding. Refresh login first to replace a cached permanent HTTPS redirect
 * from an older gateway; do not follow any redirect while checking it.
 */
async function nasReady() {
  try {
    const response = await fetch('/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && (await response.text()).trim() === 'ok') {
      const login = await fetch('/login', {
        cache: 'reload',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (login.ok) {
        window.location.assign('/login');
      }
    }
  } catch {
    console.warn('NAS not ready yet');
  }
}

/**
 * Reads where the installation is; once it is done, waits for the NAS instead.
 */
async function refresh() {
  if (handingOver.value) {
    await nasReady();
    return;
  }

  if (state.value.phase !== 'installing') {
    return;
  }

  try {
    state.value = await request<WizardState>('/wizard');
  } catch {
    console.warn('Failed to refresh wizard state');
  }
}

async function retry() {
  retrying.value = true;
  error.value = '';
  try {
    state.value = await request<WizardState>('/wizard/retry', { method: 'POST' });
  } catch (reason) {
    error.value = failureMessage(reason);
  } finally {
    retrying.value = false;
  }
}

usePolling(refresh, ref(POLL_INTERVAL));

watch(
  () => state.value.phase,
  async (phase) => {
    if (phase === 'failed') {
      await nextTick();
      root.value?.lastElementChild?.scrollIntoView?.({ block: 'end' });
    }
  },
  { immediate: true },
);

</script>

<template>
  <div ref="root" class="wizard_install" data-testid="wizard_install">
    <!-- Installation steps -->
    <ul class="app_list">
      <li
        v-for="step in visibleSteps"
        :key="step.id"
        class="wizard_install_step"
        :data-testid="`wizard_install_${step.id}`"
        :data-state="step.state"
      >
        <CommonSpinner v-if="step.state === 'running'" size="small" compact />
        <svg
          v-else-if="step.state === 'pending'"
          class="wizard_install_waiting"
          viewBox="0 0 16 16"
          :aria-label="t('install.states.pending')"
        >
          <title>{{ t('install.states.pending') }}</title>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
        <CommonIcon v-else :src="ICONS[step.state]" size="small" :label="t(STATES[step.state])" />
        <span class="wizard_install_name">{{ t(LABELS[step.id]) }}</span>
        <span v-if="step.state === 'done' && step.detail" class="muted">{{ step.detail }}</span>
        <pre v-if="step.state === 'failed'" class="wizard_install_detail">{{ step.detail }}</pre>
      </li>
    </ul>

    <!-- Wizard certificate step -->
    <WizardCertificate v-if="state.phase === 'ready'" @finished="state = $event" />

    <p
      v-if="state.phase === 'done' && state.simulated"
      class="muted"
      data-testid="wizard_simulated"
    >
      {{ t('install.simulated') }}
    </p>
    <p v-else-if="handingOver" class="muted" data-testid="wizard_handover">
      {{ t('install.handover') }}
    </p>

    <p v-if="error" role="alert" class="app_error">{{ error }}</p>

    <button
      v-if="state.phase === 'failed'"
      type="button"
      class="primary"
      :disabled="retrying"
      data-testid="wizard_retry"
      @click="retry"
    >
      <CommonSpinner v-if="retrying" size="small" compact />
      {{ t('common.retry') }}
    </button>
  </div>
</template>

<style scoped lang="scss">

.wizard_install {
  @extend %stack;
  gap: $space_4;
}

.wizard_install_step {
  @extend %panel_sunken;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space_3;
  padding: $space_3;
}

.wizard_install_name {
  flex: 1;
}

.wizard_install_waiting {
  flex-shrink: 0;
  width: $icon_small;
  height: $icon_small;
  color: var(--surface-border);
}

.wizard_install_step[data-state='running'] {
  border-color: var(--accent);
}

.wizard_install_detail {
  flex-basis: 100%;
  margin: 0;
  overflow-x: auto;
  color: var(--status-error);
  font-size: $text_label;
  white-space: pre-wrap;
}

</style>
