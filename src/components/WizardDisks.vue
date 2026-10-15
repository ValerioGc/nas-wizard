<script setup lang="ts">

import { computed } from 'vue';
import { t } from '@/i18n';
import type { DiskPlan, WizardDisks } from '@/types/types';

import AlertBanner from '@/components/alerts/AlertBanner.vue';
import CommonSegmented from '@/components/commons/CommonSegmented.vue';

interface Props {
  offer: WizardDisks;
}

const props = defineProps<Props>();
const plans = defineModel<Record<string, DiskPlan>>({ required: true });

const options = computed(() => [
  { value: 'keep' as const, label: 'wizardDiskKeep' },
  { value: 'plain' as const, label: 'wizardDiskPlain' },
  ...(props.offer.encryption
    ? [{ value: 'encrypted' as const, label: 'wizardDiskEncrypted' }]
    : []),
]);
const erasing = computed(() => Object.values(plans.value).some((plan) => plan !== 'keep'));
const encrypting = computed(() => Object.values(plans.value).includes('encrypted'));

function gigabytes(size: number) {
  return `${Math.round(size / 1e9)} GB`;
}

function choose(device: string, plan: DiskPlan) {
  plans.value = { ...plans.value, [device]: plan };
}

</script>

<template>
  <div class="wizard_disks" data-testid="wizard_disks">
    <p v-if="!offer.disks.length" class="muted">{{ t('wizardDisksNone') }}</p>
    <div v-for="disk in offer.disks" :key="disk.device" class="wizard_disk">
      <div class="wizard_disk_name">
        <strong>/dev/{{ disk.device }}</strong>
        <span class="muted">{{
          [disk.model, gigabytes(disk.size)].filter(Boolean).join(' · ')
        }}</span>
      </div>
      <CommonSegmented
        v-if="disk.empty"
        :model-value="plans[disk.device] ?? 'keep'"
        :options="options"
        :label="`/dev/${disk.device}`"
        :testid="`wizard_disk_${disk.device}`"
        @update:model-value="choose(disk.device, $event)"
      />
      <p v-else class="muted">{{ t('wizardDiskInUse') }}</p>
    </div>
    <AlertBanner v-if="erasing" tone="warning" compact>{{ t('wizardDiskWarning') }}</AlertBanner>
    <AlertBanner v-if="encrypting" tone="info" compact>{{
      t('wizardDiskEncryptedNote')
    }}</AlertBanner>
  </div>
</template>

<style scoped lang="scss">

.wizard_disks {
  display: grid;
  gap: $space_3;
}

.wizard_disk {
  display: grid;
  gap: $space_2;
}

.wizard_disk_name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: $space_2;
}

</style>
