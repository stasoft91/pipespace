export const SIMULATION_IDS = ['tubes', 'teapot', 'juliabulb'] as const;
export type SimulationId = (typeof SIMULATION_IDS)[number];

export function normalizeSimulationId(value: unknown): SimulationId | null {
  return value === 'tubes' || value === 'teapot' || value === 'juliabulb' ? value : null;
}
