import { desktopCapturer, screen } from 'electron';
import type { DictationAnchor } from './dictation-position';

export type DictationScreen = {
  dataUrl: string; width: number; height: number;
  caret: { x: number; y: number };
};

/** A single snapshot of the caret's monitor, held in memory for this request. */
export async function captureDictationScreen(caret: DictationAnchor): Promise<DictationScreen> {
  const display = screen.getDisplayNearestPoint(caret);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 1600 } });
  const source = sources.find(candidate => candidate.display_id === String(display.id));
  if (!source || source.thumbnail.isEmpty()) throw new Error('Windows could not capture this text field’s screen. Try again.');
  const size = source.thumbnail.getSize();
  const normalize = (value: number) => Math.round(Math.max(0, Math.min(1000, value)));
  return { dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(80).toString('base64')}`,
    width: size.width, height: size.height,
    caret: { x: normalize((caret.x - display.bounds.x) / display.bounds.width * 1000),
      y: normalize((caret.y - display.bounds.y) / display.bounds.height * 1000) } };
}
