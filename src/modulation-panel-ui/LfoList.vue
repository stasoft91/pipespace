<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { DraggedModulatorPayload, ModulationPanelModel, TimelineRegion } from '../modulation-panel-model';
import type { TimelineEventKind } from '../modulation-panel-types';

type Props = {
  model: ModulationPanelModel;
};

const props = defineProps<Props>();
const model = props.model;
const state = model.state;
const listRef = ref<HTMLDivElement | null>(null);
const dragOverRegionId = ref<string | null>(null);

const regions = computed(() => {
  void state.revision;
  return Array.from(state.regionsById.values()).sort((a, b) => a.startSeconds - b.startSeconds);
});

const isModSelected = (regionId: string, kind: TimelineEventKind, id: string) => {
  return (
    regionId === state.selectedRegionId &&
    state.selectedModulator?.kind === kind &&
    state.selectedModulator?.id === id
  );
};

const isModDragging = (regionId: string, kind: TimelineEventKind, id: string) => {
  const payload = state.draggingModulator;
  return payload?.fromRegionId === regionId && payload.kind === kind && payload.id === id;
};

const regionModulators = (region: TimelineRegion) => {
  const mods: Array<{ id: string; kind: TimelineEventKind; label: string }> = [];
  for (const lfo of region.lfos) {
    mods.push({ id: lfo.id, kind: 'lfo', label: `LFO - ${model.getTargetLabel(lfo.targetId)}` });
  }
  for (const env of region.envelopes) {
    mods.push({ id: env.id, kind: 'envelope', label: `ENV - ${model.getTargetLabel(env.targetId)}` });
  }
  return mods;
};

const onModDragStart = (regionId: string, kind: TimelineEventKind, id: string, event: DragEvent) => {
  const payload: DraggedModulatorPayload = { fromRegionId: regionId, kind, id };
  model.setDraggingModulator(payload);
  dragOverRegionId.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    const json = JSON.stringify(payload);
    event.dataTransfer.setData('application/x-pipes-modulator', json);
    event.dataTransfer.setData('text/plain', json);
  }
};

const onModDragEnd = () => {
  model.setDraggingModulator(null);
  dragOverRegionId.value = null;
};

const onRegionDragOver = (regionId: string, event: DragEvent) => {
  const payload = model.readDraggedModulator(event);
  if (!payload || payload.fromRegionId === regionId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOverRegionId.value = regionId;
};

const onRegionDragLeave = (regionId: string) => {
  if (dragOverRegionId.value === regionId) dragOverRegionId.value = null;
};

const onRegionDrop = (regionId: string, event: DragEvent) => {
  const payload = model.readDraggedModulator(event);
  dragOverRegionId.value = null;
  model.setDraggingModulator(null);
  if (!payload) return;
  event.preventDefault();
  event.stopPropagation();
  model.moveModulatorBetweenRegions(payload, regionId);
};

const onRegionContextMenu = (regionId: string, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  model.selectRegion(regionId);
  model.openRegionContextMenu(event.clientX, event.clientY, regionId);
};

const scrollSelectedIntoView = () => {
  const list = listRef.value;
  if (!list) return;
  const selectedEl =
    (list.querySelector('.region-mod.selected') as HTMLElement | null) ??
    (list.querySelector('.lfo-item.selected') as HTMLElement | null) ??
    (list.querySelector('.lfo-list-initial.selected') as HTMLElement | null);
  if (!selectedEl) return;

  const container = list.getBoundingClientRect();
  const rect = selectedEl.getBoundingClientRect();
  const pad = 8;
  const above = rect.top < container.top + pad;
  const below = rect.bottom > container.bottom - pad;
  if (!above && !below) return;

  selectedEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
};

watch(
  () => [state.selectedRegionId, state.selectedModulator?.id, state.selectedModulator?.kind],
  () => {
    nextTick(() => scrollSelectedIntoView());
  }
);
</script>

<template>
  <div ref="listRef" class="lfo-list">
    <div class="lfo-list-header">
      <span>Regions</span>
      <button
        type="button"
        class="lfo-list-initial"
        :class="{ selected: !state.selectedRegionId }"
        @click="model.selectRegion(null)"
      >
        Initial values
      </button>
    </div>

    <div v-if="regions.length === 0" class="lfo-empty">No regions yet - right click the waveform to add one.</div>

    <div
      v-for="region in regions"
      :key="region.id"
      class="lfo-item"
      :class="{ selected: region.id === state.selectedRegionId, 'drag-over': dragOverRegionId === region.id }"
      @click="model.selectRegion(region.id)"
      @contextmenu="onRegionContextMenu(region.id, $event)"
      @dragover="onRegionDragOver(region.id, $event)"
      @dragleave="onRegionDragLeave(region.id)"
      @drop="onRegionDrop(region.id, $event)"
    >
      <div class="lfo-title">
        {{ region.lfos.length + region.envelopes.length }}
        mod{{ region.lfos.length + region.envelopes.length === 1 ? '' : 's' }}
      </div>
      <div class="lfo-times">{{ model.fmtTime(region.startSeconds) }} -> {{ model.fmtTime(region.endSeconds) }}</div>
      <button type="button" class="lfo-remove" @click.stop="model.removeRegion(region.id)">x</button>

      <div class="region-modulators">
        <div
          v-for="mod in regionModulators(region)"
          :key="mod.id"
          class="region-mod"
          :class="{
            selected: isModSelected(region.id, mod.kind, mod.id),
            dragging: isModDragging(region.id, mod.kind, mod.id),
          }"
          draggable="true"
          @click.stop="model.selectModulatorInRegion(region.id, { kind: mod.kind, id: mod.id })"
          @dragstart="onModDragStart(region.id, mod.kind, mod.id, $event)"
          @dragend="onModDragEnd"
        >
          <span>{{ mod.label }}</span>
          <button
            type="button"
            class="region-mod-remove"
            @click.stop="model.removeModulatorFromRegion(region.id, { kind: mod.kind, id: mod.id })"
          >
            x
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
