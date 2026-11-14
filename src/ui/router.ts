import { signal } from '@preact/signals';

export type Route = 'lab' | 'assistant';

function parse(): Route {
  return location.hash.startsWith('#/assistant') ? 'assistant' : 'lab';
}

export const route = signal<Route>(parse());

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse();
  });
}

export function navigate(r: Route): void {
  if (location.hash !== `#/${r}`) location.hash = `#/${r}`;
  route.value = r;
}
