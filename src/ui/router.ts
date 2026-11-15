import { signal } from '@preact/signals';

export type Route = 'drummer' | 'editor';

/** Old hashes (#/assistant, #/lab) still work: they are rewritten to the new ones. */
function parse(): Route {
  const h = location.hash;
  if (h.startsWith('#/editor')) return 'editor';
  if (h.startsWith('#/lab')) {
    history.replaceState(null, '', '#/editor');
    return 'editor';
  }
  if (h.startsWith('#/assistant')) history.replaceState(null, '', '#/drummer');
  return 'drummer';
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
