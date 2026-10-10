/**
 * Materials for the main menu's buttons, each button its own: stone, leather, wood, a cobweb and so on.
 * They are small SVG pictures made of noise and light, so nothing has to be loaded; the button's own
 * translucent green still shows through them, and so does the backdrop.
 */

const W = 400;
const H = 64;

const svg = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${defs}</defs>${body}</svg>`;

interface Relief {
  /** Noise frequency, "x y" for grain stretched one way. */
  freq: string;
  oct: number;
  seed: number;
  /** How deep the bumps are. */
  depth: number;
  color: string;
  alpha: number;
  noise?: 'fractalNoise' | 'turbulence';
  /** Height of the light: low light shows more relief. */
  elev?: number;
}

/** A surface lit from the top left: stone, leather, bark, metal. */
const relief = (id: string, r: Relief) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="${r.noise ?? 'fractalNoise'}" baseFrequency="${r.freq}" numOctaves="${r.oct}" seed="${r.seed}" stitchTiles="stitch"/>
    <feDiffuseLighting surfaceScale="${r.depth}" diffuseConstant="1.1" lighting-color="${r.color}"><feDistantLight azimuth="235" elevation="${r.elev ?? 45}"/></feDiffuseLighting>
    <feComponentTransfer><feFuncA type="linear" slope="0" intercept="${r.alpha}"/></feComponentTransfer>
  </filter>`;

const fill = (id: string) => `<rect width="100%" height="100%" filter="url(#${id})"/>`;

/** Thin winding lines where the noise crosses its middle: cracks, veins, frost; `glow` makes them shine. `thin` narrows them. */
const veins = (id: string, freq: string, seed: number, color: string, thin: number, glow = 0, oct = 3) => {
  const ridge = [...Array(thin).fill(0), 1, ...Array(thin).fill(0)].join(' ');
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/>
    <feComponentTransfer><feFuncR type="table" tableValues="${ridge}"/></feComponentTransfer>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="a"/>
    <feFlood flood-color="${color}" flood-opacity=".85"/><feComposite operator="in" in2="a" result="line"/>
    ${glow ? `<feGaussianBlur stdDeviation="${glow}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="line"/></feMerge>` : ''}
  </filter>`;
};

/** Soft clouds of colour: moss, smoke, mould. */
const blotch = (id: string, freq: string, seed: number, color: string, slope: number, shift: number, oct = 4) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${slope} 0 0 0 ${shift}" result="a"/>
    <feFlood flood-color="${color}"/><feComposite operator="in" in2="a"/>
  </filter>`;

/** Darker edges, so the label in the middle reads well on any material. */
const vignette = `<radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="40%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient>`;
const shade = `<rect width="100%" height="100%" fill="url(#v)"/>`;

const stone = (seed: number, color = '#5d6b60', alpha = 0.55) =>
  relief('s', { freq: '0.035 0.05', oct: 5, seed, depth: 3, color, alpha, elev: 40 });

const MATERIALS = {
  /** Embers glowing through cracked rock. */
  ember: svg(stone(3, '#4a3a33', 0.6) + veins('c', '0.012 0.03', 7, '#ff7a2e', 40, 1.2, 4) + vignette, fill('s') + fill('c') + shade),
  /** Dried blood in the cracks of dark rock. */
  blood: svg(stone(11, '#3e2a2c', 0.62) + veins('c', '0.015 0.035', 2, '#c0182f', 40, 0.8, 4) + vignette, fill('s') + fill('c') + shade),
  /** Rime spreading over cold stone. */
  frost: svg(stone(5, '#4d5f6b', 0.55) + veins('c', '0.03 0.05', 9, '#cdeeff', 45, 0.5, 4) + vignette, fill('s') + fill('c') + shade),
  /** Green veins in black marble. */
  marble: svg(
    relief('s', { freq: '0.01 0.02', oct: 3, seed: 4, depth: 0.6, color: '#2b3330', alpha: 0.6, elev: 60 }) + veins('c', '0.01 0.03', 12, '#7fd6a0', 45, 0.5, 5) + vignette,
    fill('s') + fill('c') + shade,
  ),
  /** Plain grey stone, cut in blocks. */
  stone: svg(
    stone(21, '#66705f', 0.6) + vignette,
    fill('s') + `<path d="M0 32H400M130 0V32M290 32V64" stroke="#000" stroke-opacity=".55" stroke-width="2"/><path d="M0 34H400M132 0V32M292 34V64" stroke="#fff" stroke-opacity=".08" stroke-width="1"/>` + shade,
  ),
  /** Worn leather with stitching along the edges. */
  leather: svg(
    relief('s', { freq: '0.22', oct: 3, seed: 8, depth: 1.6, color: '#6b4a32', alpha: 0.6, noise: 'turbulence', elev: 50 }) + vignette,
    fill('s') + `<rect x="6" y="6" width="388" height="52" rx="6" fill="none" stroke="#c9a77a" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="6 5"/>` + shade,
  ),
  /** Planks of old wood along the button. */
  wood: svg(
    relief('s', { freq: '0.006 0.32', oct: 4, seed: 6, depth: 2.4, color: '#6e5136', alpha: 0.6, elev: 40 }) + vignette,
    fill('s') + `<path d="M0 21H400M0 43H400" stroke="#000" stroke-opacity=".5" stroke-width="2"/>` + shade,
  ),
  /** Rough bark across the button. */
  bark: svg(relief('s', { freq: '0.02 0.18', oct: 5, seed: 13, depth: 5, color: '#55473a', alpha: 0.6, noise: 'turbulence', elev: 30 }) + vignette, fill('s') + shade),
  /** Brushed iron held by rivets at both ends. */
  iron: svg(
    relief('s', { freq: '0.002 0.9', oct: 2, seed: 2, depth: 0.8, color: '#7c8a86', alpha: 0.5, elev: 55 }) +
      `<radialGradient id="r" cx="35%" cy="35%" r="65%"><stop offset="0" stop-color="#c8d4cf"/><stop offset=".6" stop-color="#4b5753"/><stop offset="1" stop-color="#151b19"/></radialGradient>` +
      vignette,
    fill('s') + [14, 386].flatMap((x) => [14, 50].map((y) => `<circle cx="${x}" cy="${y}" r="5" fill="url(#r)"/>`)).join('') + shade,
  ),
  /** Rusted metal, patchy and pitted. */
  rust: svg(
    relief('s', { freq: '0.08', oct: 4, seed: 17, depth: 1.5, color: '#7a4a2a', alpha: 0.5, elev: 50 }) + blotch('m', '0.03', 19, '#a3541f', 3, -1.3) + vignette,
    fill('s') + `<g opacity=".55">${fill('m')}</g>` + shade,
  ),
  /** Moss creeping over damp stone. */
  moss: svg(stone(29, '#4c5a4e', 0.55) + blotch('m', '0.04 0.07', 31, '#3f7a2c', 3.2, -1.2, 5) + vignette, fill('s') + `<g opacity=".5">${fill('m')}</g>` + shade),
  /** Smoke drifting across. */
  smoke: svg(blotch('m', '0.008 0.04', 37, '#8a9891', 2.4, -0.9, 5) + vignette, `<g opacity=".5">${fill('m')}</g>` + shade),
  /** Dark parchment, stained. */
  parchment: svg(
    relief('s', { freq: '0.04', oct: 5, seed: 41, depth: 0.7, color: '#6e6046', alpha: 0.55, elev: 65 }) + blotch('m', '0.02', 43, '#2a1d10', 2.6, -1, 4) + vignette,
    fill('s') + `<g opacity=".6">${fill('m')}</g>` + shade,
  ),
  /** Black glass with sharp light streaks. */
  obsidian: svg(
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1110" stop-opacity=".7"/><stop offset=".45" stop-color="#20302a" stop-opacity=".6"/><stop offset=".5" stop-color="#5e7a6c" stop-opacity=".5"/><stop offset=".56" stop-color="#18221e" stop-opacity=".6"/><stop offset="1" stop-color="#050807" stop-opacity=".75"/></linearGradient>` +
      veins('c', '0.004 0.025', 47, '#9ad8b6', 40, 0, 3) +
      vignette,
    `<rect width="100%" height="100%" fill="url(#g)"/><g opacity=".5">${fill('c')}</g>` + shade,
  ),
  /** A cobweb strung from the corners: the network game's button. */
  cobweb: svg(
    vignette,
    `<rect width="100%" height="100%" fill="#0a0f0c" fill-opacity=".35"/>` +
      `<g fill="none" stroke="#dfe9e2" stroke-opacity=".32" stroke-width=".9">` +
      [0, 400]
        .map((cx) => {
          const s = cx ? -1 : 1;
          const rays = [0, 18, 38, 60, 90].map((a) => {
            const r = (a * Math.PI) / 180;
            return `M${cx} 0L${cx + s * 130 * Math.cos(r)} ${130 * Math.sin(r)}`;
          });
          const rings = [26, 48, 72, 98].map((d) => {
            const pts = [0, 18, 38, 60, 90].map((a) => {
              const r = (a * Math.PI) / 180;
              return `${(cx + s * d * Math.cos(r)).toFixed(1)} ${(d * Math.sin(r)).toFixed(1)}`;
            });
            return `M${pts.join('Q' + (cx + s * d * 0.55).toFixed(1) + ' ' + (d * 0.55).toFixed(1) + ' ')}`;
          });
          return [...rays, ...rings].map((d) => `<path d="${d}"/>`).join('');
        })
        .join('') +
      `</g>` +
      shade,
  ),
  /** Overlapping scales, like a serpent's hide. */
  scales: svg(
    `<pattern id="p" width="20" height="14" patternUnits="userSpaceOnUse"><path d="M0 14A10 10 0 0 1 20 14M-10 7A10 10 0 0 1 10 7M10 7A10 10 0 0 1 30 7" fill="#1d3a29" fill-opacity=".5" stroke="#8fd1a6" stroke-opacity=".35" stroke-width="1"/></pattern>` +
      vignette,
    `<rect width="100%" height="100%" fill="url(#p)"/>` + shade,
  ),
  /** Faint runes cut into the surface. */
  runes: svg(
    stone(53, '#4f5a52', 0.5) + vignette,
    fill('s') +
      `<g fill="none" stroke="#8dffad" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round">` +
      ['M0 0V22M0 4L8 10M0 12L8 6', 'M0 0V22M8 0V22M0 6L8 14', 'M4 0V22M0 6L4 0L8 6', 'M0 0L8 11L0 22M8 0V22', 'M0 22L4 0L8 22M2 12H6', 'M0 0H8L0 22H8']
        .flatMap((d, i) => [
          `<path transform="translate(${18 + i * 28} 21)" d="${d}"/>`,
          `<path transform="translate(${226 + i * 28} 21)" d="${d}"/>`,
        ])
        .join('') +
      `</g>` +
      shade,
  ),
  /** Bones laid side by side. */
  bone: svg(
    relief('s', { freq: '0.05 0.2', oct: 3, seed: 59, depth: 1, color: '#8a8270', alpha: 0.45, elev: 55 }) + vignette,
    fill('s') +
      `<g fill="#d9d0b8" fill-opacity=".22">` +
      Array.from({ length: 9 }, (_, i) => {
        const x = 10 + i * 46;
        return `<rect x="${x + 6}" y="28" width="26" height="8" rx="3"/><circle cx="${x + 5}" cy="27" r="5"/><circle cx="${x + 5}" cy="37" r="5"/><circle cx="${x + 33}" cy="27" r="5"/><circle cx="${x + 33}" cy="37" r="5"/>`;
      }).join('') +
      `</g>` +
      shade,
  ),
  /** Heavy chain links across the middle. */
  chain: svg(
    stone(61, '#4b524e', 0.5) +
      `<linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c4bf"/><stop offset=".5" stop-color="#4a5450"/><stop offset="1" stop-color="#1a201e"/></linearGradient>` +
      vignette,
    fill('s') +
      `<g fill="none" stroke="url(#l)" stroke-opacity=".55" stroke-width="4">` +
      Array.from({ length: 12 }, (_, i) => (i % 2 ? `<rect x="${i * 34 - 6}" y="28" width="40" height="8" rx="4"/>` : `<rect x="${i * 34 - 6}" y="20" width="40" height="24" rx="12"/>`)).join('') +
      `</g>` +
      shade,
  ),
} satisfies Record<string, string>;

export type Material = keyof typeof MATERIALS;

/** Which material each button of the menu wears; no two are alike. */
const BUTTONS: Record<string, Material> = {
  play: 'ember',
  net: 'cobweb',
  rating: 'iron',
  settings: 'rust',
  continue: 'wood',
  learn: 'leather',
  bot: 'bone',
  'lesson-basic': 'parchment',
  'lesson-advanced': 'runes',
  'level-easy': 'moss',
  'level-medium': 'scales',
  'level-hard': 'blood',
  reconnect: 'chain',
  host: 'marble',
  join: 'bark',
  enter: 'bark',
  'nick-ok': 'frost',
  'nick-skip': 'smoke',
  rules: 'obsidian',
  back: 'stone',
};

const urls = new Map<Material, string>();

export function materialUrl(m: Material): string {
  let url = urls.get(m);
  if (!url) {
    url = `url("data:image/svg+xml,${encodeURIComponent(MATERIALS[m].replace(/\s+/g, ' '))}")`;
    urls.set(m, url);
  }
  return url;
}

/** The inline style that dresses a menu button in its material; nothing for a button without one. */
export function textureStyle(go: string): string {
  const m = BUTTONS[go];
  return m ? ` style="--tex: ${materialUrl(m).replace(/"/g, '&quot;')}"` : '';
}

export const MATERIAL_NAMES = Object.keys(MATERIALS) as Material[];
