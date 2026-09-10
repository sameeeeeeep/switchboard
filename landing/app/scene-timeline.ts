import { scenarios } from './scenarios';
import { journeyOrder } from './journey';

export const beatDurations = [3000, 1400, 1700, 1800, 2000, 1400, 1400, 1400, 1800, 1400, 2500];
export const finalBeat = beatDurations.length - 1;
export type SceneState = { story: number; provider: number; beat: number; run: number };

export function advance(state: SceneState, action: 'tick' | 'next' | 'still' | 'replay' | { chapter: number }): SceneState {
  if (typeof action === 'object') return { ...state, story: journeyOrder[action.chapter] ?? 0, beat: 0, run: state.run + 1 };
  if (action === 'still') return { ...state, beat: finalBeat };
  if (action === 'replay') return { ...state, beat: 0, run: state.run + 1 };
  if (action === 'next' || state.beat === finalBeat) {
    const story = journeyOrder[(journeyOrder.indexOf(state.story) + 1) % journeyOrder.length];
    // Keep the same AI throughout a launch; switch provider on the next full launch.
    return { story, provider: story === 0 ? 1 - state.provider : state.provider, beat: 0, run: state.run + 1 };
  }
  let beat = state.beat + 1;
  const story = scenarios[state.story];
  if (beat === 2 && story.input !== 'voice') beat = 3;
  if (beat === 4 && story.local) beat = 5;
  if (beat === 9 && !story.voice) beat = finalBeat;
  return { ...state, beat };
}

export function previewStage(beat: number) {
  if (beat < 3) return 0;
  if (beat < 5) return 1;
  if (beat === 5) return 2;
  if (beat === 6) return 3;
  return 4;
}
