import code from '../server/rating.gs?raw';

/*
 * Runs server/rating.gs outside Google: an in-memory spreadsheet and the few Apps Script
 * services the script calls. The tests use it, and so can a local stand-in for the web app.
 */

type Cell = string | number | boolean | Date;

class FakeSheet {
  rows: Cell[][] = [];
  constructor(readonly name: string) {}
  appendRow(row: Cell[]) {
    this.rows.push([...row]);
  }
  deleteRow(n: number) {
    this.rows.splice(n - 1, 1);
  }
  setFrozenRows() {}
  getDataRange() {
    return { getValues: () => this.rows.map((r) => [...r]) };
  }
  getRange(row: number, col: number, nr = 1, nc = 1) {
    const set = (values: Cell[][]) => {
      for (let i = 0; i < nr; i++) {
        const r = (this.rows[row - 1 + i] ??= []);
        for (let j = 0; j < nc; j++) r[col - 1 + j] = values[i][j];
      }
    };
    return { setValues: set, setValue: (v: Cell) => set([[v]]) };
  }
}

export interface RatingScript {
  /** The sheets by title. */
  book: Map<string, FakeSheet>;
  get(params?: Record<string, string>): any;
  post(body: unknown): any;
  recalc(): void;
}

export function loadRatingScript(): RatingScript {
  const book = new Map<string, FakeSheet>();
  const spreadsheet = {
    getSheetByName: (n: string) => book.get(n) ?? null,
    insertSheet: (n: string) => {
      const s = new FakeSheet(n);
      book.set(n, s);
      return s;
    },
  };
  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      // Stands in for SHA-256: the script only compares digests.
      computeDigest: (_: string, s: string) => `digest:${s}`,
      base64Encode: (d: string) => d,
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType() {
        return this;
      } }),
    },
  };
  const names = Object.keys(services);
  const run = new Function(...names, `${code}\nreturn { doGet, doPost, recalc };`)(...Object.values(services));
  return {
    book,
    get: (params = {}) => JSON.parse(run.doGet({ parameter: params }).text),
    post: (body) => JSON.parse(run.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text),
    recalc: () => run.recalc(),
  };
}
