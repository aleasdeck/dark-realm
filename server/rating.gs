/**
 * Dark Realm: the rating table of network games, kept in a Google Sheet.
 *
 * Paste this file into the sheet's Apps Script (Extensions → Apps Script) and deploy it
 * as a web app (Execute as: Me, Who has access: Anyone). The game reads the table with
 * GET and reports finished network games with POST.
 *
 * A game counts only when both players report it, with the same match id and opposite
 * results; one side alone can't add a win. A name belongs to the device that first played
 * under it (its secret key is kept here as a hash), so nobody else can play under it.
 * Ratings are Elo, starting at 1000. Each player's favourite deck is the patron they most
 * often pick first in the draft, counted over their counted games.
 *
 * Sheets (created on first use):
 *   Рейтинг: one row per name. Clearing a row's «Ключ» frees the name for a new device.
 *            «Первые пики» counts each patron picked first, e.g. "crows:3, rats:1".
 *   Партии:  the counted games. Delete a row and run «Рейтинг → Пересчитать рейтинг»
 *            to take a game back.
 *   Заявки:  games reported by one side, waiting for the other.
 */

const SHEETS = {
  players: ['Рейтинг', ['Имя', 'Рейтинг', 'Победы', 'Поражения', 'Партий', 'Последняя партия', 'Ключ', 'Первые пики']],
  games: ['Партии', ['Дата', 'Победитель', 'Проигравший', 'Рейтинг победителя', 'Рейтинг проигравшего', 'Изменение', 'Ходов', 'Партия', 'Пик победителя', 'Пик проигравшего']],
  reports: ['Заявки', ['Время', 'Партия', 'Имя', 'Соперник', 'Итог', 'Ходов', 'Первый пик']],
};
const START = 1000;
const K = 32;
/** The name of a player who never set one: their games don't count. */
const DEFAULT_NAME = 'Странник';
/** A report the other side never confirmed is dropped after this long. */
const REPORT_DAYS = 7;
const TOP = 200;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.match) return json(matchStatus(String(p.match), clean(p.name)));
  return json({ ok: true, players: top() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad' });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return json(report(body));
  } finally {
    lock.releaseLock();
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Рейтинг').addItem('Пересчитать рейтинг', 'recalc').addToUi();
}

// ── reports ─────────────────────────────────────────────

/** One side's word on a finished game: { match, name, key, opp, won, turns, pick }. */
function report(b) {
  const match = String(b.match || '');
  const name = clean(b.name);
  const opp = clean(b.opp);
  const key = String(b.key || '');
  if (!/^[A-Za-z0-9-]{6,40}$/.test(match) || !name || !opp || same(name, opp) || !/^[A-Za-z0-9]{16,64}$/.test(key) || typeof b.won !== 'boolean') {
    return { ok: false, error: 'bad' };
  }
  if (same(name, DEFAULT_NAME) || same(opp, DEFAULT_NAME)) return { ok: false, error: 'no-name' };
  const turns = Math.max(0, Math.min(9999, Math.floor(Number(b.turns) || 0)));
  // The patron this player picked first in the draft (its id); older games send none.
  const pick = /^[a-z_]{2,24}$/.test(String(b.pick || '')) ? String(b.pick) : '';

  const players = sheet('players');
  const rows = players.getDataRange().getValues();
  const hash = digest(key);
  const at = rows.findIndex((r, i) => i > 0 && same(r[0], name));
  if (at > 0) {
    const owner = String(rows[at][6] || '');
    if (owner && owner !== hash) return { ok: false, error: 'name-taken' };
    if (!owner) players.getRange(at + 1, 7).setValue(hash);
  } else {
    players.appendRow([name, START, 0, 0, 0, '', hash, '']);
  }

  if (findGame(match)) return matchStatus(match, name);

  const reports = sheet('reports');
  dropStale(reports);
  const list = reports.getDataRange().getValues();
  const mine = list.findIndex((r, i) => i > 0 && String(r[1]) === match && same(r[2], name));
  if (mine < 0) reports.appendRow([new Date(), match, name, opp, b.won ? 'победа' : 'поражение', turns, pick]);
  else reports.getRange(mine + 1, 4, 1, 4).setValues([[opp, b.won ? 'победа' : 'поражение', turns, pick]]);

  const theirs = list.find((r, i) => i > 0 && String(r[1]) === match && same(r[2], opp));
  if (!theirs) return { ok: true, status: 'pending' };
  // The two reports must name each other and disagree on who won.
  if (!same(theirs[3], name) || (theirs[4] === 'победа') === b.won) return { ok: true, status: 'conflict' };

  const winner = b.won ? name : opp;
  const loser = b.won ? opp : name;
  const theirPick = String(theirs[6] || '');
  record(winner, loser, Math.max(turns, Number(theirs[5]) || 0), match, b.won ? pick : theirPick, b.won ? theirPick : pick);
  removeReports(reports, match);
  return matchStatus(match, name);
}

/** Where a match stands for one of its players. */
function matchStatus(match, name) {
  const g = findGame(match);
  if (g) {
    const won = same(g[1], name);
    if (!won && !same(g[2], name)) return { ok: true, status: 'none' };
    return { ok: true, status: 'done', rating: Number(won ? g[3] : g[4]), delta: won ? Number(g[5]) : -Number(g[5]) };
  }
  const list = sheet('reports')
    .getDataRange()
    .getValues()
    .filter((r, i) => i > 0 && String(r[1]) === match);
  if (list.length > 1) return { ok: true, status: 'conflict' };
  return { ok: true, status: list.some((r) => same(r[2], name)) ? 'pending' : 'none' };
}

function findGame(match) {
  return sheet('games')
    .getDataRange()
    .getValues()
    .find((r, i) => i > 0 && String(r[7]) === match);
}

function removeReports(reports, match) {
  const list = reports.getDataRange().getValues();
  for (let i = list.length - 1; i > 0; i--) if (String(list[i][1]) === match) reports.deleteRow(i + 1);
}

function dropStale(reports) {
  const list = reports.getDataRange().getValues();
  const old = Date.now() - REPORT_DAYS * 864e5;
  for (let i = list.length - 1; i > 0; i--) if (new Date(list[i][0]).getTime() < old) reports.deleteRow(i + 1);
}

// ── ratings ─────────────────────────────────────────────

/** How many points the winner takes from the loser. */
function eloDelta(winner, loser) {
  const expected = 1 / (1 + Math.pow(10, (loser - winner) / 400));
  return Math.max(1, Math.round(K * (1 - expected)));
}

/** Counts a confirmed game: both players' rows and a row in Партии. */
function record(winner, loser, turns, match, winnerPick, loserPick) {
  const players = sheet('players');
  const rows = players.getDataRange().getValues();
  const wi = rows.findIndex((r, i) => i > 0 && same(r[0], winner));
  const li = rows.findIndex((r, i) => i > 0 && same(r[0], loser));
  if (wi < 1 || li < 1) return;
  const w = rows[wi];
  const l = rows[li];
  const d = eloDelta(Number(w[1]) || START, Number(l[1]) || START);
  const now = new Date();
  players.getRange(wi + 1, 2, 1, 5).setValues([[(Number(w[1]) || START) + d, (Number(w[2]) || 0) + 1, Number(w[3]) || 0, (Number(w[4]) || 0) + 1, now]]);
  players.getRange(li + 1, 2, 1, 5).setValues([[(Number(l[1]) || START) - d, Number(l[2]) || 0, (Number(l[3]) || 0) + 1, (Number(l[4]) || 0) + 1, now]]);
  if (winnerPick) players.getRange(wi + 1, 8).setValue(writePicks(addPick(readPicks(w[7]), winnerPick)));
  if (loserPick) players.getRange(li + 1, 8).setValue(writePicks(addPick(readPicks(l[7]), loserPick)));
  sheet('games').appendRow([now, w[0], l[0], (Number(w[1]) || START) + d, (Number(l[1]) || START) - d, d, turns, match, winnerPick, loserPick]);
}

/** Plays every game in Партии again from 1000, after a game was deleted or edited by hand. */
function recalc() {
  const players = sheet('players');
  const rows = players.getDataRange().getValues();
  const byName = {};
  for (let i = 1; i < rows.length; i++) byName[String(rows[i][0]).toLowerCase()] = { rating: START, wins: 0, losses: 0, last: '', picks: {} };
  const games = sheet('games');
  const list = games.getDataRange().getValues();
  for (let i = 1; i < list.length; i++) {
    const g = list[i];
    const w = byName[String(g[1]).toLowerCase()];
    const l = byName[String(g[2]).toLowerCase()];
    if (!w || !l) continue;
    const d = eloDelta(w.rating, l.rating);
    w.rating += d;
    l.rating -= d;
    w.wins++;
    l.losses++;
    w.last = l.last = g[0];
    if (g[8]) addPick(w.picks, String(g[8]));
    if (g[9]) addPick(l.picks, String(g[9]));
    games.getRange(i + 1, 4, 1, 3).setValues([[w.rating, l.rating, d]]);
  }
  for (let i = 1; i < rows.length; i++) {
    const p = byName[String(rows[i][0]).toLowerCase()];
    players.getRange(i + 1, 2, 1, 5).setValues([[p.rating, p.wins, p.losses, p.wins + p.losses, p.last]]);
    players.getRange(i + 1, 8).setValue(writePicks(p.picks));
  }
}

/** Players with at least one counted game, best first. */
function top() {
  return sheet('players')
    .getDataRange()
    .getValues()
    .slice(1)
    .filter((r) => Number(r[4]) > 0)
    .map((r) => ({ name: String(r[0]), rating: Number(r[1]), wins: Number(r[2]), losses: Number(r[3]), deck: favourite(readPicks(r[7])) }))
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
    .slice(0, TOP);
}

// ── first picks ─────────────────────────────────────────

/** "crows:3, rats:1" → { crows: 3, rats: 1 } */
function readPicks(cell) {
  const counts = {};
  String(cell || '')
    .split(',')
    .forEach((part) => {
      const [id, n] = part.split(':').map((x) => x.trim());
      if (/^[a-z_]{2,24}$/.test(id) && Number(n) > 0) counts[id] = Number(n);
    });
  return counts;
}

function writePicks(counts) {
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .map((id) => `${id}:${counts[id]}`)
    .join(', ');
}

function addPick(counts, id) {
  counts[id] = (counts[id] || 0) + 1;
  return counts;
}

/** The patron picked first most often; '' before any. */
function favourite(counts) {
  let best = '';
  for (const id of Object.keys(counts)) if (!best || counts[id] > counts[best]) best = id;
  return best;
}

// ── helpers ─────────────────────────────────────────────

/** A sheet by its key in SHEETS, created with its header row if missing. */
function sheet(id) {
  const [title, head] = SHEETS[id];
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let s = book.getSheetByName(title);
  if (!s) {
    s = book.insertSheet(title);
    s.appendRow(head);
    s.setFrozenRows(1);
  } else if (head.some((h, i) => s.getDataRange().getValues()[0][i] !== h)) {
    // A table made by an older version of this script: name its new columns.
    s.getRange(1, 1, 1, head.length).setValues([head]);
  }
  return s;
}

/** A player name as the table keeps it; a leading = + - @ would turn it into a formula. */
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[=+\-@']+/, '')
    .slice(0, 24);
}

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function digest(key) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key));
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
