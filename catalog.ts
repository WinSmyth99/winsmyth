export * from './types';
export * from './evaluate';
export * from './cascade';

import { GameType } from './types';

export const TYPE_PROFILES: Record<GameType, { vol: 'low' | 'medium' | 'high' | 'insane'; label: string }> = {
  paylines: { vol: 'medium', label: 'Classic Lines' },
  ways: { vol: 'medium', label: 'All Ways' },
  scatter: { vol: 'high', label: 'Scatter Pays' },
  cluster: { vol: 'insane', label: 'Cluster Pays' },
};
