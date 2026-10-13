<script setup lang="ts">

import { ref } from 'vue';
import { t } from '@/i18n';

import CommonIcon from '@/components/commons/CommonIcon.vue';
import eyeIcon from '@/assets/icons/system/eye.svg';
import eyeOffIcon from '@/assets/icons/system/eye_off.svg';

interface Props {
  id: string;
  newPassword?: boolean;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<Props>(), { newPassword: false });
const model = defineModel<string>({ required: true });
const visible = ref(false);

</script>

<template>
  <span class="common_password">
    <input
      v-bind="$attrs"
      :id="props.id"
      v-model="model"
      :type="visible ? 'text' : 'password'"
      :autocomplete="props.newPassword ? 'new-password' : 'off'"
    />
    <button
      type="button"
      class="common_password_toggle"
      :aria-label="t(visible ? 'hidePassword' : 'showPassword')"
      :aria-pressed="visible"
      @click="visible = !visible"
    >
      <CommonIcon :src="visible ? eyeOffIcon : eyeIcon" tinted />
    </button>
  </span>
</template>

<style scoped lang="scss">

.common_password {
  position: relative;
  display: flex;

  input {
    flex: 1;
    padding-right: $space_10;
  }
}

.common_password_toggle {
  @extend %icon_button;
  position: absolute;
  top: 50%;
  right: $space_2 * 0.5;
  min-height: 0;
  transform: translateY(-50%);
  color: var(--surface-muted);

  &:hover:not(:disabled),
  &[aria-pressed='true'] {
    border-color: transparent;
    background: transparent;
    color: var(--accent);
  }
}

</style>
