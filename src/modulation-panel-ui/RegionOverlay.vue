<script setup lang="ts">
import { onMounted, onUnmounted, watchEffect } from 'vue';
import type { ModulationPanelModel } from '../modulation-panel-model';

type Props = {
  model: ModulationPanelModel;
  overlayContainer: HTMLElement;
};

const props = defineProps<Props>();
const model = props.model;
const state = model.state;

const onPointerMove = (event: PointerEvent) => {
  if (!state.overlay.visible) return;
  if (model.updateRegionDrag(event.clientX)) {
    event.preventDefault();
  }
};

const onPointerUp = () => {
  model.endRegionDrag();
};

const beginDrag = (regionId: string, mode: 'move' | 'resize-start' | 'resize-end', event: PointerEvent) => {
  const secondsPerPx = state.overlay.secondsPerPx;
  if (!isFinite(secondsPerPx) || secondsPerPx <= 0) return;
  event.preventDefault();
  event.stopPropagation();
  model.beginRegionDrag(regionId, mode, secondsPerPx, event);
};

const onBlockContextMenu = (regionId: string, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  model.selectRegion(regionId);
  model.openRegionContextMenu(event.clientX, event.clientY, regionId);
};

const onBlockPointerDown = (regionId: string, selected: boolean, event: PointerEvent) => {
  if (!selected) return;
  beginDrag(regionId, 'move', event);
};

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
});

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});

watchEffect(() => {
  const overlay = state.overlay;
  const container = props.overlayContainer;
  container.style.display = overlay.visible ? 'block' : 'none';
  container.style.height = overlay.visible ? `${overlay.heightPx}px` : '0px';
});
</script>

<template>
  <div
    v-for="row in state.overlay.rows"
    :key="row.id"
    class="region-lane-row"
    :style="{ height: `${row.heightPx}px`, width: `${row.widthPx}px` }"
  >
    <div
      v-for="block in row.blocks"
      :key="block.id"
      class="region-block"
      :class="{ selected: block.selected }"
      :style="{ left: `${block.left}px`, width: `${block.width}px`, top: `${block.top}px`, bottom: `${block.bottom}px` }"
      :title="block.title"
      @click.stop="model.selectRegion(block.regionId)"
      @contextmenu="onBlockContextMenu(block.regionId, $event)"
      @pointerdown="onBlockPointerDown(block.regionId, block.selected, $event)"
    >
      <div class="region-label" :style="{ display: block.showLabel ? '' : 'none' }">{{ block.label }}</div>
      <div
        v-if="block.selected"
        class="region-handle start"
        @pointerdown.stop="beginDrag(block.regionId, 'resize-start', $event)"
      ></div>
      <div
        v-if="block.selected"
        class="region-handle end"
        @pointerdown.stop="beginDrag(block.regionId, 'resize-end', $event)"
      ></div>
    </div>
  </div>
</template>
