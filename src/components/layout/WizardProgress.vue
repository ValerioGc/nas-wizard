<script setup lang="ts">

import { t } from '@/i18n';

interface Props {
  current: number;
  total: number;
}

const props = defineProps<Props>();

</script>

<template>
  <ol
    class="wizard_progress"
    :aria-label="t('common.stepOf', { step: props.current, total: props.total })"
    data-testid="wizard_progress"
  >
    <li
      v-for="step in props.total"
      :key="step"
      class="wizard_progress_step"
      :class="{ wizard_progress_done: step < props.current }"
      :aria-current="step === props.current ? 'step' : undefined"
    >
      <span class="wizard_progress_dot">{{ step }}</span>
    </li>
  </ol>
</template>

<style scoped lang="scss">

.wizard_progress {
  display: flex;
  align-items: center;
}

.wizard_progress_step {
  display: flex;
  flex: 1;
  align-items: center;

  &::after {
    content: '';
    flex: 1;
    height: $border_thin * 2;
    margin-inline: $space_2;
    border-radius: $border_thin;
    background: var(--surface-border);
    transition: background $duration_fast;
  }

  &:last-child {
    flex: 0;

    &::after {
      display: none;
    }
  }
}

.wizard_progress_dot {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: $space_8;
  height: $space_8;
  border: $border_thin * 2 solid var(--surface-border);
  border-radius: 50%;
  color: var(--surface-muted);
  font-size: $text_label;
  font-weight: 600;
  transition:
    background $duration_fast,
    border-color $duration_fast,
    color $duration_fast;
}

.wizard_progress_done {
  &::after {
    background: var(--accent);
  }

  .wizard_progress_dot {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
}

.wizard_progress_step[aria-current='step'] .wizard_progress_dot {
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 0 0 $focus_offset color-mix(in srgb, var(--accent) 25%, transparent);
}

</style>
