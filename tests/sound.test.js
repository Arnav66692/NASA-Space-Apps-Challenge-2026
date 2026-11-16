// Checks for the ambient music settings. Written with an AI tool (Claude).
// The sound itself is checked in a real browser, since Node has no Web Audio.
import { describe, it, expect } from 'vitest';
import { readChoice, CHORDS, KEY } from '../src/sound.js';

const store = (value) => ({ getItem: (k) => (k === KEY ? value : null) });

describe('sound choice', () => {
  it('is off when nothing was saved', () => {
    expect(readChoice(store(null))).toBe(false);
  });
  it('is on only when "on" was saved', () => {
    expect(readChoice(store('on'))).toBe(true);
    expect(readChoice(store('off'))).toBe(false);
    expect(readChoice(store('yes'))).toBe(false);
  });
  it('is off when storage is missing or refuses', () => {
    expect(readChoice(null)).toBe(false);
    expect(readChoice({ getItem: () => { throw new Error('denied'); } })).toBe(false);
  });
});

describe('chords', () => {
  it('stay in a calm range, nothing below D2 or above A4, with the low note quietest', () => {
    for (const notes of CHORDS) {
      for (const [m] of notes) expect(m >= 38 && m <= 69).toBe(true);
      const [lowNote, lowDb] = notes[0];
      expect(lowNote).toBe(Math.min(...notes.map(([m]) => m)));
      expect(lowDb).toBe(Math.min(...notes.map(([, d]) => d)));
    }
  });
});
