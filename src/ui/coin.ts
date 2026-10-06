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

const SUN = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor">
  <circle cx="32" cy="32" r="11"/>
  ${Array.from({ length: 8 }, (_, i) => `<path d="M30 6h4l-2 11z" transform="rotate(${i * 45} 32 32)"/>`).join('')}
</g></svg>`;
const MOON = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor"
  d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z"/>
  <circle cx="44" cy="22" r="2" fill="currentColor"/><circle cx="50" cy="31" r="1.4" fill="currentColor"/></svg>`;

let open: HTMLElement | null = null;

export function closeCoin() {
  open?.remove();
  open = null;
}

export function showCoin(meFirst: boolean, done: () => void) {
  closeCoin();
  const box = document.createElement('div');
  box.className = 'overlay coin-toss';
  box.innerHTML = `<div class="coin-box">
    <h2>Жребий</h2>
    <p class="coin-key"><span class="you">${SUN} вы</span><span class="them">${MOON} соперник</span></p>
    <div class="coin-stage"><div class="toss-coin"><div class="face sun">${SUN}</div><div class="face moon">${MOON}</div></div></div>
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
  const result = box.querySelector<HTMLElement>('.coin-result')!;
  // The moon is the back of the coin: it lands face down when the opponent moves first.
  const end = meFirst ? 0 : 180;
  const land = () => {
    if (closed) return;
    result.classList.add('shown');
    play('coin');
    timer = window.setTimeout(close, SHOW_MS);
  };
  // Rests on the result once the spin is over.
  coin.style.transform = `rotateY(${end}deg)`;
  if (still()) return land();

  const turns = 5 * 360 + end;
  // Up slowing down, then down speeding up.
  coin.animate(
    [
      { transform: 'translateY(0) scale(1) rotateY(0deg)', easing: 'cubic-bezier(.2,.7,.4,1)' },
      { transform: `translateY(-70%) scale(1.25) rotateY(${turns * 0.5}deg)`, offset: 0.48, easing: 'cubic-bezier(.6,0,.8,.5)' },
      { transform: `translateY(0) scale(1) rotateY(${turns}deg)` },
    ],
    SPIN_MS,
  );
  play('toss');
  timer = window.setTimeout(land, SPIN_MS);
}
