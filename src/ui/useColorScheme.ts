import { useSyncExternalStore } from 'react';

const query = '(prefers-color-scheme: dark)';

function subscribe(fn: () => void): () => void {
  const media = matchMedia(query);
  media.addEventListener('change', fn);
  return () => media.removeEventListener('change', fn);
}

export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () => (matchMedia(query).matches ? 'dark' : 'light'));
}
