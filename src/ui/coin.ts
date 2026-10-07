import { icon } from './icons';
import { richText } from './rich';
import { still } from './motion';
import { play } from './sound';

/**
 * The coin toss before the draft: a coin with a sun (you) and a moon (the opponent) spins up
 * and lands on the side of whoever moves first. With animations off only the result is shown.
 * It closes by itself, or at a tap, and then calls `done`.
 */

const SPIN_MS = 1700;
/** How long the result stays up after the coin lands. */
const SHOW_MS = 2200;
/** How far the coin leans back at rest. */
const TILT = 24;

const SUN = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor">
  <circle cx="32" cy="32" r="11"/>
  ${Array.from({ length: 8 }, (_, i) => `<path d="M30 6h4l-2 11z" transform="rotate(${i * 45} 32 32)"/>`).join('')}
</g></svg>`;
const MOON = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor"
  d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z"/>
  <circle cx="44" cy="22" r="2" fill="currentColor"/><circle cx="50" cy="31" r="1.4" fill="currentColor"/></svg>`;

/** The painted coin faces, or the drawn sun and moon when the files are missing. */
const sun = () => icon('coin_sun', SUN);
const moon = () => icon('coin_moon', MOON);

/** The face that came up for this player: the sun for you, the moon for the opponent. */
export const coinFace = (mine: boolean) => (mine ? sun() : moon());

/**
 * The coin's thickness: thin discs stacked between the faces, lit in the middle like the side
 * of a cylinder, so the edge shows while it tumbles and at rest.
 */
const RIMS = 14;
function rim(painted: boolean): string {
  // Dark stone round the painted faces, bronze round the drawn ones.
  const [h, sat, l] = painted ? [28, 9, 21] : [38, 60, 28];
  return Array.from({ length: RIMS }, (_, i) => {
    const z = i / (RIMS - 1) - 0.5;
    const light = l + 9 * (1 - Math.abs(z) * 2) - (i % 2) * 3;
    return `<i class="rim" style="--z:${z.toFixed(3)};background:hsl(${h} ${sat}% ${light.toFixed(1)}%)"></i>`;
  }).join('');
}

let open: HTMLElement | null = null;

export function closeCoin() {
  open?.remove();
  open = null;
}

export function showCoin(meFirst: boolean, done: () => void) {
  closeCoin();
  const painted = !!icon('coin_sun');
  const box = document.createElement('div');
  box.className = 'overlay coin-toss';
  box.innerHTML = `<div class="coin-box">
    <h2>Жребий</h2>
    <p class="coin-key"><span class="you">${sun()} вы</span><span class="them">${moon()} соперник</span></p>
    <div class="coin-stage"><i class="coin-shadow"></i><div class="toss-coin${painted ? ' painted' : ''}">${rim(painted)}<div class="face sun">${sun()}</div><div class="face moon">${moon()}</div></div></div>
    <div class="coin-result">
      <h3 class="${meFirst ? 'you' : 'them'}">${meFirst ? 'Вы ходите первым' : 'Соперник ходит первым'}</h3>
      <p>${richText(
        meFirst
          ? 'Вы первым выбираете покровителя. Соперник получит +1 ● в свой первый ход.'
          : 'Соперник первым выбирает покровителя. Вы получите +1 ● в свой первый ход.',
      )}</p>
    </div>
  </div>`;
  document.body.appendChild(box);
  open = box;

  let closed = false;
  let timer = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (still()) {
      if (open === box) closeCoin();
    } else {
      box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).finished.then(() => {
        if (open === box) closeCoin();
      });
    }
    done();
  };
  box.addEventListener('click', close);

  const coin = box.querySelector<HTMLElement>('.toss-coin')!;
  const shadow = box.querySelector<HTMLElement>('.coin-shadow')!;
  const result = box.querySelector<HTMLElement>('.coin-result')!;
  // The moon is the back of the coin: it lands face down when the opponent moves first.
  const end = meFirst ? 0 : 180;
  const land = () => {
    if (closed) return;
    result.classList.add('shown');
    if (!still()) coin.classList.add('shine');
    play('coin');
    timer = window.setTimeout(close, SHOW_MS);
  };
  // It tumbles end over end and lies tilted back at rest, so its edge shows below the face.
  const pose = (y: string, scale: number, turn: number) => `translateY(${y}) scale(${scale}) rotateX(${turn + TILT}deg)`;
  coin.style.transform = pose('0', 1, end);
  if (still()) return land();

  const turns = 5 * 360 + end;
  // Up slowing down, then down speeding up; the shadow shrinks and fades while it is up.
  const up = 'cubic-bezier(.2,.7,.4,1)';
  const down = 'cubic-bezier(.6,0,.8,.5)';
  coin.animate(
    [
      { transform: pose('0', 1, 0), easing: up },
      { transform: pose('-70%', 1.25, turns * 0.5), offset: 0.48, easing: down },
      { transform: pose('0', 1, turns) },
    ],
    SPIN_MS,
  );
  shadow.animate(
    [
      { transform: 'scale(1)', opacity: 1, easing: up },
      { transform: 'scale(.45)', opacity: 0.35, offset: 0.48, easing: down },
      { transform: 'scale(1)', opacity: 1 },
    ],
    SPIN_MS,
  );
  play('toss');
  timer = window.setTimeout(land, SPIN_MS);
}
