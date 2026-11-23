<script setup lang="ts">

import { computed } from 'vue';
import { t } from '@/i18n';
import type { DiskPlan, WizardDisk, WizardDisks } from '@/types/types';

import AlertBanner from '@/components/alerts/AlertBanner.vue';
import CommonIcon from '@/components/commons/CommonIcon.vue';
import CommonSegmented from '@/components/commons/CommonSegmented.vue';

import lockIcon from '@/assets/icons/network/lock.svg';
import successIcon from '@/assets/icons/status/success.svg';
import warningIcon from '@/assets/icons/status/warning.svg';
import diskIcon from '@/assets/icons/system/disk.svg';

interface Props {
  offer: WizardDisks;
}

type DiskState = 'inUse' | 'empty' | 'erasing';

defineProps<Props>();
const plans = defineModel<Record<string, DiskPlan>>({ required: true });

const options = [
  { value: 'keep' as const, label: 'disks.options.keep' },
  { value: 'plain' as const, label: 'disks.options.plain' },
];

const stateIcons: Record<DiskState, string> = {
  inUse: lockIcon,
  empty: successIcon,
  erasing: warningIcon,
};

const erasing = computed(() => Object.values(plans.value).some((plan) => plan !== 'keep'));

function capacity(size: number) {
  if (size >= 1e12) {
    return `${Math.round(size / 1e11) / 10} TB`;
  }
  return `${Math.round(size / 1e9)} GB`;
}

function state(disk: WizardDisk): DiskState {
  if (!disk.empty) {
    return 'inUse';
  }
  return plans.value[disk.device] === 'plain' ? 'erasing' : 'empty';
}

function choose(device: string, plan: DiskPlan) {
  plans.value = { ...plans.value, [device]: plan };
}

</script>

<template>
  <div class="wizard_disks" data-testid="wizard_disks">
    <p v-if="!offer.disks.length" class="muted">{{ t('disks.none') }}</p>
    <ul v-else class="app_list">
      <li
        v-for="disk in offer.disks"
        :key="disk.device"
        class="wizard_disk"
        :class="`wizard_disk_${state(disk)}`"
        :data-testid="`wizard_disk_${disk.device}_card`"
      >
        <span class="wizard_disk_tile">
          <CommonIcon :src="diskIcon" size="large" tinted />
        </span>

        <div class="wizard_disk_info">
          <div class="wizard_disk_title">
            <strong>/dev/{{ disk.device }}</strong>
            <span
              class="wizard_disk_state"
              :title="disk.empty ? undefined : t('disks.inUseHint')"
              :data-testid="`wizard_disk_${disk.device}_state`"
            >
              <CommonIcon :src="stateIcons[state(disk)]" size="small" tinted />
              {{ t(`disks.state.${state(disk)}`) }}
              <span v-if="!disk.empty" class="visually_hidden">{{ t('disks.inUseHint') }}</span>
            </span>
          </div>
          <div class="wizard_disk_meta">
            <span class="wizard_disk_capacity">{{ capacity(disk.size) }}</span>
            <span v-if="disk.model" class="muted wizard_disk_model">{{ disk.model }}</span>
          </div>
        </div>

        <CommonSegmented
          v-if="disk.empty"
          class="wizard_disk_plan"
          :model-value="plans[disk.device] ?? 'keep'"
          :options="options"
          :label="`/dev/${disk.device}`"
          :testid="`wizard_disk_${disk.device}`"
          @update:model-value="choose(disk.device, $event)"
        />
      </li>
    </ul>

    <AlertBanner v-if="erasing" tone="warning" compact>{{ t('disks.warning') }}</AlertBanner>
    <AlertBanner v-if="offer.disks.some((disk) => disk.empty)" tone="info" compact>
      <span data-testid="wizard_disks_encryption_note">{{ t('disks.encryptionNote') }}</span>
    </AlertBanner>
  </div>
</template>

<style scoped lang="scss">

.wizard_disks {
  @extend %stack;
  gap: $space_3;
  container-type: inline-size;
}

.wizard_disk {
  @extend %panel_sunken;
  @extend %fx_base;
  flex-wrap: wrap;
  gap: $space_3 $space_4;
  padding: $space_3 $space_4;
  border-color: color-mix(in srgb, var(--disk-tone) 30%, var(--surface-border));
  transition:
    border-color $duration_fast,
    background-color $duration_fast;
}

.wizard_disk_inUse {
  --disk-tone: var(--status-info);
}

.wizard_disk_empty {
  --disk-tone: var(--status-success);
}

.wizard_disk_erasing {
  --disk-tone: var(--status-warning);
  border-color: color-mix(in srgb, var(--disk-tone) 60%, transparent);
  background: color-mix(in srgb, var(--disk-tone) 7%, var(--surface-sunken));
}

.wizard_disk_tile {
  @extend %fx_base;
  justify-content: center;
  width: $space_10 + $space_2;
  height: $space_10 + $space_2;
  border: $border_thin solid color-mix(in srgb, var(--disk-tone) 35%, transparent);
  border-radius: $radius_control;
  background: color-mix(in srgb, var(--disk-tone) 14%, var(--surface));
  color: var(--disk-tone);
}

.wizard_disk_info {
  display: grid;
  flex: 1 1 12rem;
  gap: $space_2 * 0.5;
  min-width: 0;
}

.wizard_disk_title,
.wizard_disk_meta {
  @extend %fx_base;
  gap: $space_2;
  min-width: 0;
}

.wizard_disk_title strong {
  font-size: $text_large;
  letter-spacing: 0.01em;
}

.wizard_disk_state,
.wizard_disk_capacity {
  @extend %fx_base;
  gap: $space_2 * 0.5;
  padding: 0 $space_2;
  border-radius: $radius_large;
  font-size: $text_label;
  line-height: 1.6;
  white-space: nowrap;
}

.wizard_disk_state {
  border: $border_thin solid color-mix(in srgb, var(--disk-tone) 45%, transparent);
  background: color-mix(in srgb, var(--disk-tone) 14%, var(--surface));
  color: var(--disk-tone);
  font-weight: 600;
}

.wizard_disk_capacity {
  border: $border_thin solid var(--surface-border);
  background: var(--surface);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.wizard_disk_model {
  @extend %truncated_text;
}

.wizard_disk_plan {
  flex: 0 1 auto;

  @container (width < 30rem) {
    flex-basis: 100%;
  }
}

</style>
