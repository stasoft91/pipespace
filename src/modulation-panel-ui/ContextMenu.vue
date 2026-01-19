<script setup lang="ts">
import type { ModulationPanelModel } from '../modulation-panel-model';

type Props = {
  model: ModulationPanelModel;
};

const props = defineProps<Props>();
const state = props.model.state;

const onItemClick = (item: { disabled?: boolean; action: () => void }) => {
  if (item.disabled) return;
  item.action();
  props.model.closeContextMenu();
};
</script>

<template>
  <div
    v-if="state.contextMenu.open"
    class="lfo-context-menu"
    :style="{ left: `${state.contextMenu.x}px`, top: `${state.contextMenu.y}px` }"
    @click.stop
    @contextmenu.prevent
  >
    <button
      v-for="item in state.contextMenu.items"
      :key="item.id"
      type="button"
      :disabled="item.disabled"
      @click="onItemClick(item)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
