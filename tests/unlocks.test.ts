import { beforeEach, describe, expect, it, vi } from 'vitest';

function stubStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  vi.stubGlobal('location', { search: '' });
  return data;
}

// unlocks.ts caches the patrons kept from the old counter, so each test loads it fresh.
const load = () => import('../src/ui/unlocks');

describe('unlocks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('opens patrons by wins, not by games played', async () => {
    const data = stubStorage();
    const u = await load();
    for (let i = 0; i < 6; i++) expect(u.recordGame(false)).toEqual([]);
    expect(u.isUnlocked('hunding')).toBe(false);
    for (let i = 0; i < 4; i++) u.recordGame(true);
    expect(u.unlockLeft('hunding')).toBe('Откроется через 1 победу');
    expect(u.recordGame(true)).toEqual(['hunding']);
    expect(u.unlockLeft('orgnum')).toBe('Откроется через 5 побед');
    expect(data.get('dr-wins')).toBe('5');
    expect(data.get('dr-games')).toBe('11');
  });

  it('keeps patrons already opened by the old games counter', async () => {
    stubStorage({ 'dr-games': '12' });
    const u = await load();
    expect(u.isUnlocked('hunding')).toBe(true);
    expect(u.isUnlocked('orgnum')).toBe(true);
    expect(u.isUnlocked('alessia')).toBe(false);
    expect(u.unlockLeft('alessia')).toBe('Откроется через 20 побед');
  });

  it('does not re-grant from the games counter once wins are counted', async () => {
    stubStorage({ 'dr-games': '30', 'dr-wins': '2', 'dr-unlocked': '["hunding"]' });
    const u = await load();
    expect(u.isUnlocked('hunding')).toBe(true);
    expect(u.isUnlocked('orgnum')).toBe(false);
  });
});
