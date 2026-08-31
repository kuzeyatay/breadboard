export type MusicRecognitionProvider = "audd" | "acrcloud" | "shazam" | "songrec";

export interface RecognizedSong {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  label?: string;
  timecode?: string;
  isrc?: string;
  /** Present only when the recognition provider supplies a meaningful score. */
  confidence?: number;
  provider: MusicRecognitionProvider;
  artwork?: string;
  links?: {
    song?: string;
    spotify?: string;
    appleMusic?: string;
  };
}

export interface MusicRecognitionResult {
  match: RecognizedSong | null;
}
