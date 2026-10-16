<script setup lang="ts">

import logoSource from '@/assets/logo.svg';

interface Props {
  title: string;
  description?: string;
  logo?: boolean;
}

const props = withDefaults(defineProps<Props>(), { description: undefined, logo: false });

</script>

<template>
  <section
    class="app_panel wizard_step"
    :class="{ wizard_step_intro: props.logo }"
    :aria-label="props.title"
    data-testid="wizard_step"
  >
    <header class="wizard_header">
      <img v-if="props.logo" class="wizard_logo" :src="logoSource" alt="" />
      <h1>{{ props.title }}</h1>
      <p v-if="props.description" class="muted">{{ props.description }}</p>
    </header>

    <div class="wizard_body">
      <slot></slot>
    </div>

    <footer v-if="$slots.actions" class="app_toolbar wizard_actions">
      <slot name="actions"></slot>
    </footer>
  </section>
</template>

<style scoped lang="scss">

.wizard_step {
  @extend %stack;
  gap: $space_5;
  width: 100%;
  max-width: $wizard_width;
  height: $wizard_height;
  max-height: calc(100svh - #{$space_4 * 2});
  padding: $space_6;

  h1 {
    margin-bottom: $space_2;
  }
}

.wizard_header {
  text-align: center;
}

// The body takes the height the header leaves, so the actions stay at the foot of every step.
.wizard_body {
  @extend %stack;
  flex: 1 1 auto;
  gap: $space_5;
  min-height: 0;
  margin: -($focus_width + $focus_offset);
  padding: $focus_width + $focus_offset;
  overflow-y: auto;
  @extend %hidden_scrollbar;
}

.wizard_step_intro {
  justify-content: center;

  .wizard_body {
    flex-grow: 0;
  }
}

.wizard_logo {
  width: $wizard_logo_size;
  height: $wizard_logo_size;
  margin-bottom: $space_4;
}

// Back at the start of the row, forward at its end; the first page has only its centered start.
.wizard_actions {
  justify-content: space-between;

  :slotted(button:last-child) {
    margin-left: auto;
  }
}

.wizard_step_intro .wizard_actions {
  justify-content: center;

  :slotted(button:last-child) {
    margin-left: 0;
  }
}

</style>
