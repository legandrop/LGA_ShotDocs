import { useSyncStatus } from '../services';

export function usePendingCount(): number {
  const s = useSyncStatus();
  return s.pendingOps + s.pendingPages + s.pendingFiles;
}
