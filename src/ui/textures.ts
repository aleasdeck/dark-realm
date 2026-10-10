/**
 * The main menu's buttons are slabs of dark stone, and no two slabs are alike: each button grows its own
 * grain and cracks from a seed made of its name. The slab is a small SVG of noise and light, so nothing
 * has to be loaded; the button's own translucent green and the backdrop still show through it.
 */

const W = 400;
const H = 64;

/** A stable number from a button's name, so it keeps its pattern from one visit to the next. */
function seedOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The stone slab for one seed: lit grain, cracks cut into it with a pale lip, darker edges. */
function slab(seed: number): string {
  const s = seed % 997;
  // Each slab has its own grain size and crack density, so they differ at a glance, not just in detail.
  const grain = (0.03 + ((seed >>> 10) % 30) / 1000).toFixed(3);
  const crack = (0.006 + ((seed >>> 16) % 20) / 1000).toFixed(3);
  const thin = 24 + ((seed >>> 20) % 12);
  const ridge = [...Array(thin).fill(0), 1, ...Array(thin).fill(0)].join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <filter id="s" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${grain} ${(+grain * 1.4).toFixed(3)}" numOctaves="5" seed="${s}" stitchTiles="stitch"/>
      <feDiffuseLighting surfaceScale="3" diffuseConstant="1.1" lighting-color="#5d6b60"><feDistantLight azimuth="235" elevation="40"/></feDiffuseLighting>
      <feComponentTransfer><feFuncA type="linear" slope="0" intercept=".58"/></feComponentTransfer>
    </filter>
    <filter id="c" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${crack} ${(+crack * 2.2).toFixed(3)}" numOctaves="4" seed="${s + 1}" stitchTiles="stitch"/>
      <feComponentTransfer><feFuncR type="table" tableValues="${ridge}"/></feComponentTransfer>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="a"/>
      <feFlood flood-color="#cfe0d4" flood-opacity=".28"/><feComposite operator="in" in2="a"/><feOffset dx="1" dy="1" result="lip"/>
      <feFlood flood-color="#000" flood-opacity=".85"/><feComposite operator="in" in2="a" result="cut"/>
      <feMerge><feMergeNode in="lip"/><feMergeNode in="cut"/></feMerge>
    </filter>
    <radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="40%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient>
  </defs><rect width="100%" height="100%" filter="url(#s)"/><rect width="100%" height="100%" filter="url(#c)"/><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
}

const urls = new Map<string, string>();

/** The button's slab as a CSS image. */
export function slabUrl(name: string): string {
  let url = urls.get(name);
  if (!url) {
    url = `url("data:image/svg+xml,${encodeURIComponent(slab(seedOf(name)).replace(/\s+/g, ' '))}")`;
    urls.set(name, url);
  }
  return url;
}

/** The inline style that lays a menu button's own slab under its label. */
export const textureStyle = (go: string): string => ` style="--tex: ${slabUrl(go).replace(/"/g, '&quot;')}"`;
