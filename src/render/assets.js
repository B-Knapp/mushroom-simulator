// Image assets (textures and the forest backdrop). Loaded once; anything
// that fails to load is null, and the painter falls back to drawing it
// procedurally.

const FILES = {
  humus: 'assets/soil-humus.jpg',
  clay: 'assets/soil-clay.jpg',
  gravel: 'assets/soil-gravel.jpg',
  moss: 'assets/moss-ground.jpg',
  bark: 'assets/bark.jpg',
  endGrain: 'assets/end-grain.jpg',
  forest: 'assets/forest.jpg',
};

let loading = null;

export function loadAssets() {
  if (!loading) {
    loading = Promise.all(Object.entries(FILES).map(([key, src]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve([key, img]);
      img.onerror = () => { console.warn('Could not load', src); resolve([key, null]); };
      img.src = src;
    }))).then((pairs) => Object.fromEntries(pairs));
  }
  return loading;
}
