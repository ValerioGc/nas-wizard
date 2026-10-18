<script setup lang="ts">

import { computed, ref } from 'vue';
import { t } from '@/i18n';
import type { Locale, Theme } from '@/types/types';
import { isNasName } from '@/utils/loginValidation';

import CommonField from '@/components/commons/CommonField.vue';
import CommonSegmented from '@/components/commons/CommonSegmented.vue';

const name = defineModel<string>('name', { required: true });
const language = defineModel<Locale>('language', { required: true });
const theme = defineModel<Theme>('theme', { required: true });

const touched = ref(false);
const nameError = computed(() =>
  touched.value && !isNasName(name.value) ? t('appearance.name.invalid') : '',
);

const languages: { value: Locale; label: string }[] = [
  { value: 'it', label: 'appearance.language.options.it' },
  { value: 'en', label: 'appearance.language.options.en' },
];

const themes: { value: Theme; label: string }[] = [
  { value: 'system', label: 'appearance.theme.options.system' },
  { value: 'light', label: 'appearance.theme.options.light' },
  { value: 'dark', label: 'appearance.theme.options.dark' },
];

</script>

<template>
  <div class="wizard_choices">
    <CommonField :error="nameError">
      <label for="wizard_nas_name">{{ t('appearance.name.label') }}</label>
      <input
        id="wizard_nas_name"
        v-model="name"
        type="text"
        maxlength="63"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="!!nameError"
        data-testid="wizard_nas_name"
        @input="touched = true"
      />
    </CommonField>

    <CommonField>
      <span>{{ t('appearance.language.label') }}</span>
      <CommonSegmented
        v-model="language"
        :options="languages"
        :label="t('appearance.language.label')"
        testid="wizard_language"
      />
    </CommonField>

    <CommonField>
      <span>{{ t('appearance.theme.label') }}</span>
      <CommonSegmented
        v-model="theme"
        :options="themes"
        :label="t('appearance.theme.label')"
        testid="wizard_theme"
      />
    </CommonField>
  </div>
</template>

<style scoped lang="scss">

.wizard_choices {
  @extend %stack;
  gap: $space_4;
}

</style>
