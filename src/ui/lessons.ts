import type { ScriptId } from '../engine/types';

/*
 * Which tutorials the player has won, kept in localStorage. Until the basics are done (or a game
 * has been played) the «Обучение» button glows to catch a newcomer's eye.
 */
const key = (lesson: ScriptId) => `dr-lesson-${lesson}`;

export function lessonDone(lesson: ScriptId): boolean {
  try {
    return localStorage.getItem(key(lesson)) === '1';
  } catch {
    return false;
  }
}

export function markLessonDone(lesson: ScriptId) {
  try {
    localStorage.setItem(key(lesson), '1');
  } catch {
    /* storage unavailable: the button just keeps glowing */
  }
}

/** A newcomer: no basics won and no game finished yet. */
export function newcomer(): boolean {
  try {
    return !lessonDone('basic') && !(Number(localStorage.getItem('dr-games')) > 0);
  } catch {
    return true;
  }
}
