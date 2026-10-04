/** Preview page for the procedural art (art-preview.html). Query: ?view=check|grid|emblems, &only=a,b, &scale=1|2 */
import { artUrl, cardBackUrl, patronEmblemUrl, SUBJECTS, type ArtPalette, type Subject } from './index';

const PALETTES: ArtPalette[] = [
  { bg1: '#140c22', bg2: '#2a1530', accent: '#8a3fc0', glow: '#c08aff' },
  { bg1: '#0a1418', bg2: '#16302c', accent: '#2f9a7a', glow: '#7affc8' },
  { bg1: '#1c0a08', bg2: '#3a1410', accent: '#c0402a', glow: '#ffb050' },
  { bg1: '#0a0e1c', bg2: '#1a2440', accent: '#3a6ad0', glow: '#9ad0ff' },
];

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'grid';
const only = q.get('only')?.split(',').filter(Boolean) as Subject[] | undefined;
const scale = q.get('scale') === '1' ? 's1' : '';
const pi = Number(q.get('pal') ?? 0);
const root = document.getElementById('root')!;

function fig(url: string, label: string): HTMLElement {
  const f = document.createElement('figure');
  if (scale) f.className = scale;
  const img = document.createElement('img');
  img.src = url;
  img.alt = label;
  const c = document.createElement('figcaption');
  c.textContent = label;
  f.append(img, c);
  return f;
}
function section(title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  const g = document.createElement('div');
  g.className = 'grid';
  root.append(h, g);
  return g;
}

const t0 = performance.now();
const subjects = only ?? [...SUBJECTS];
if (view === 'check') {
  const g = section('Subjects');
  for (const s of subjects) g.append(fig(artUrl(s, PALETTES[pi % PALETTES.length]!, Number(q.get('seed') ?? 1)), s));
} else if (view === 'grid') {
  for (const s of subjects) {
    const g = section(s);
    PALETTES.forEach((p, i) => g.append(fig(artUrl(s, p, i + 1), `${s} p${i} s${i + 1}`)));
  }
}
if (view !== 'check' || q.has('extras')) {
  for (const p of PALETTES.slice(0, 2)) {
    const g = section('Patron emblems');
    for (const id of ['crows', 'hlaalu', 'pelin', 'psijic', 'rajhin', 'eagle', 'treasury', 'unknown']) g.append(fig(patronEmblemUrl(id, p), id));
  }
  section('Card back').append(fig(cardBackUrl(), 'card back'));
}
const ms = performance.now() - t0;
// startup budget check: ~80 fresh images
const t1 = performance.now();
for (const s of SUBJECTS) artUrl(s, { bg1: '#101010', bg2: '#202020', accent: '#a04040', glow: '#ffa060' }, 99);
for (const id of ['crows', 'hlaalu', 'pelin', 'psijic', 'rajhin', 'eagle', 'treasury']) patronEmblemUrl(id, { bg1: '#101010', bg2: '#202020', accent: '#a04040', glow: '#ffa060' });
const ms2 = performance.now() - t1;
document.getElementById('stats')!.textContent = `page render ${ms.toFixed(0)} ms; ${SUBJECTS.length + 7} fresh images (art + emblems, png data URLs) in ${ms2.toFixed(0)} ms`;
