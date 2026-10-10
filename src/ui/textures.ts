/**
 * The main menu's buttons are slabs of dark stone, and no two slabs are alike: each button grows its own
 * grain and cracks from a seed made of its name. Under the finger the cracks light up from inside: a second
 * picture with the same cracks, glowing, fades in over the slab. Both are small SVGs of noise and light,
 * so nothing has to be loaded; the backdrop still shows faintly through the stone.
 */

const W = 400;
const H = 64;

/** A stable number from a button's name, so it keeps its pattern from one visit to the next. */
function seedOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** What makes one slab unlike another: its grain size and its cracks, all from the seed. */
function shape(seed: number) {
  const crack = 0.006 + ((seed >>> 16) % 20) / 1000;
  const thin = 24 + ((seed >>> 20) % 12);
  return {
    s: seed % 997,
    grain: (0.03 + ((seed >>> 10) % 30) / 1000).toFixed(3),
    crack: `${crack.toFixed(3)} ${(crack * 2.2).toFixed(3)}`,
    ridge: [...Array(thin).fill(0), 1, ...Array(thin).fill(0)].join(' '),
  };
}

const svg = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${defs}</defs>${body}</svg>`;

/** The cracks as a mask, the same in the slab and in its glow so the two line up. */
const cracks = (k: ReturnType<typeof shape>) =>
  `<feTurbulence type="fractalNoise" baseFrequency="${k.crack}" numOctaves="4" seed="${k.s + 1}" stitchTiles="stitch"/>
   <feComponentTransfer><feFuncR type="table" tableValues="${k.ridge}"/></feComponentTransfer>
   <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="a"/>`;

const fill = (id: string) => `<rect width="100%" height="100%" filter="url(#${id})"/>`;

/** The stone slab: lit grain, cracks cut into it with a pale lip, darker edges. */
function slab(seed: number): string {
  const k = shape(seed);
  return svg(
    `<filter id="s" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${k.grain} ${(+k.grain * 1.4).toFixed(3)}" numOctaves="5" seed="${k.s}" stitchTiles="stitch"/>
      <feDiffuseLighting surfaceScale="3" diffuseConstant="1" lighting-color="#3a443e"><feDistantLight azimuth="235" elevation="40"/></feDiffuseLighting>
      <feComponentTransfer><feFuncA type="linear" slope="0" intercept=".8"/></feComponentTransfer>
    </filter>
    <filter id="c" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${cracks(k)}
      <feFlood flood-color="#b7c9bc" flood-opacity=".2"/><feComposite operator="in" in2="a"/><feOffset dx="1" dy="1" result="lip"/>
      <feFlood flood-color="#000" flood-opacity=".9"/><feComposite operator="in" in2="a" result="cut"/>
      <feMerge><feMergeNode in="lip"/><feMergeNode in="cut"/></feMerge>
    </filter>
    <radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="35%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".65"/></radialGradient>`,
    fill('s') + fill('c') + `<rect width="100%" height="100%" fill="url(#v)"/>`,
  );
}

/** The same cracks burning green, with a halo, for when the button is pressed. */
function glow(seed: number): string {
  const k = shape(seed);
  return svg(
    `<filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${cracks(k)}
      <feFlood flood-color="#b8ffcc"/><feComposite operator="in" in2="a" result="core"/>
      <feFlood flood-color="#3fdc72"/><feComposite operator="in" in2="a"/><feGaussianBlur stdDeviation="2.4" result="halo"/>
      <feMerge><feMergeNode in="halo"/><feMergeNode in="halo"/><feMergeNode in="core"/></feMerge>
    </filter>`,
    fill('g'),
  );
}

const cache = new Map<string, string>();

/** No single quotes in the pictures, so the URL can sit in single quotes inside a double-quoted attribute. */
const asUrl = (picture: string) => `url('data:image/svg+xml,${encodeURIComponent(picture.replace(/\s+/g, ' '))}')`;

/** The inline style that lays a menu button's own slab under its label, and its glowing cracks ready above. */
export function textureStyle(go: string): string {
  let style = cache.get(go);
  if (!style) {
    const seed = seedOf(go);
    style = ` style="--tex: ${asUrl(slab(seed))}; --glow: ${asUrl(glow(seed))}"`;
    cache.set(go, style);
  }
  return style;
}
