"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ExternalLink, ListPlus, Music2, Play, X } from "lucide-react";
import { cancelNavigationProgress, startNavigationProgress } from "@/app/components/navigation-progress";
import type { SpotifyArtist, SpotifyArtistProfile, SpotifyRelease, SpotifyTrack } from "@/lib/spotify/service";

function Artwork({ imageUrl, className = "" }: { imageUrl: string | null; className?: string }) {
  return <span className={`browser-spotify-profile-art ${className}`} aria-hidden="true"
    style={imageUrl ? { backgroundImage: `url("${imageUrl.replace(/"/gu, "%22")}")` } : undefined}>
    {!imageUrl ? <Music2 /> : null}
  </span>;
}

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function BrowserSpotifyArtistProfile({
  artist, active, busy, ready, playbackError, onBack, onClose, playArtist, playTrack, playRelease, playPlaylist, addToPlaylist,
}: {
  artist: SpotifyArtist;
  active: boolean;
  busy: boolean;
  ready: boolean;
  playbackError: string;
  onBack: () => void;
  onClose: () => void;
  playArtist: () => void;
  playTrack: (track: SpotifyTrack, queue: SpotifyTrack[]) => void;
  playRelease: (release: SpotifyRelease) => void;
  playPlaylist: (uri: string) => void;
  addToPlaylist: (track: SpotifyTrack) => void;
}) {
  const [profile, setProfile] = useState<SpotifyArtistProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [releaseFilter, setReleaseFilter] = useState<"all" | "album" | "single">("all");
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) backRef.current?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    const controller = new AbortController();
    startNavigationProgress();
    void fetch(`/api/browser/spotify?view=artist&id=${encodeURIComponent(artist.id)}`, {cache: "no-store", signal: controller.signal})
      .then(async response => {
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "This artist profile is unavailable.");
        if (payload.artist?.id !== artist.id) throw new Error("This artist profile is unavailable.");
        setProfile(payload as SpotifyArtistProfile);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "This artist profile is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) { setLoading(false); cancelNavigationProgress(); }
      });
    return () => { controller.abort(); cancelNavigationProgress(); };
  }, [artist.id, revision]);

  const retry = () => { setLoading(true); setError(""); setRevision(value => value + 1); };
  const currentArtist = profile?.artist ?? artist;
  const tracks = profile?.tracks ?? [];
  const releases = (profile?.releases ?? []).filter(release => releaseFilter === "all" || release.type === releaseFilter);
  const sectionError = (message?: string) => message ? (
    <div className="browser-spotify-profile-error" role="alert"><span>{message}</span><button type="button" onClick={retry} disabled={loading}>Try again</button></div>
  ) : null;
  const heroStyle = currentArtist.imageUrl ? {
    "--spotify-artist-image": `url("${currentArtist.imageUrl.replace(/"/gu, "%22")}")`,
  } as CSSProperties : undefined;

  return (
    <div className="browser-spotify-artist-profile" aria-label={`${currentArtist.name} artist profile`} aria-busy={loading}>
      <nav className="browser-spotify-profile-nav" aria-label="Artist navigation">
        <button ref={backRef} type="button" onClick={onBack} aria-label="Back to search"><ChevronLeft /></button>
        <button type="button" onClick={onClose} aria-label="Close Spotify"><X /></button>
      </nav>
      <header className="browser-spotify-profile-hero" style={heroStyle}>
        <span className="browser-spotify-profile-kicker">Artist</span>
        <h2>{currentArtist.name}</h2>
      </header>
      <div className="browser-spotify-profile-actions">
        <button type="button" className="browser-spotify-profile-play" disabled={busy || !ready} onClick={playArtist} aria-label={`Play music by ${currentArtist.name}`}><Play /></button>
        <a href={`https://open.spotify.com/artist/${currentArtist.id}`} target="_blank" rel="noopener noreferrer">Open in Spotify<ExternalLink aria-hidden="true" /></a>
      </div>
      {sectionError(error)}
      {playbackError ? <p className="browser-spotify-profile-error" role="alert">{playbackError}</p> : null}
      <section className="browser-spotify-profile-section" aria-label="Artist songs">
        <h3>{profile?.tracksSource === "search" ? "Songs" : "Top songs"}</h3>
        {sectionError(profile?.errors.tracks)}
        <div className="browser-spotify-profile-tracks">
          {tracks.slice(0, expanded ? 10 : 5).map((track, index) => (
            <div className="browser-spotify-profile-track" key={track.uri}>
              <button type="button" disabled={busy || !ready} onClick={() => playTrack(track, tracks.slice(index))} aria-label={`Play ${track.name} by ${track.artist}`}>
                <span className="browser-spotify-profile-rank">{index + 1}</span>
                <Artwork imageUrl={track.imageUrl} />
                <span className="browser-spotify-profile-track-copy"><strong>{track.name}</strong><small>{track.album}</small></span>
                <span className="browser-spotify-profile-duration">{duration(track.durationMs)}</span>
              </button>
              <button type="button" className="browser-spotify-track-action" onClick={() => addToPlaylist(track)} disabled={busy} aria-label={`Add ${track.name} to a playlist`}><ListPlus /></button>
            </div>
          ))}
        </div>
        {tracks.length > 5 ? <button type="button" className="browser-spotify-profile-more" onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</button> : null}
        {!loading && !error && !profile?.errors.tracks && !tracks.length ? <p className="browser-spotify-profile-empty">No songs available.</p> : null}
      </section>
      <section className="browser-spotify-profile-section" aria-label="Discography">
        <h3>Discography</h3>
        <div className="browser-spotify-release-filters" role="group" aria-label="Filter releases">
          {([ ["all", "All releases"], ["album", "Albums"], ["single", "Singles & EPs"] ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={releaseFilter === value} onClick={() => setReleaseFilter(value)}>{label}</button>
          ))}
        </div>
        {sectionError(profile?.errors.releases)}
        <div className="browser-spotify-profile-shelf">
          {releases.map(release => <button type="button" className="browser-spotify-release" key={release.id} disabled={busy || !ready} onClick={() => playRelease(release)} aria-label={`Play ${release.name}`}>
            <Artwork imageUrl={release.imageUrl} />
            <strong>{release.name}</strong><small>{[release.releaseDate.slice(0, 4), release.type === "single" ? "Single / EP" : release.type === "album" ? "Album" : "Compilation"].filter(Boolean).join(" · ")}</small>
          </button>)}
        </div>
        {!loading && !error && !profile?.errors.releases && !releases.length ? <p className="browser-spotify-profile-empty">No releases available.</p> : null}
      </section>
      <section className="browser-spotify-profile-section" aria-label="Artist playlists">
        <h3>Playlists</h3>
        {sectionError(profile?.errors.playlists)}
        <div className="browser-spotify-profile-shelf">
          {(profile?.playlists ?? []).map(playlist => <button type="button" className="browser-spotify-release" key={playlist.id} disabled={busy || !ready} onClick={() => playPlaylist(playlist.uri)} aria-label={`Play ${playlist.name}`}>
            <Artwork imageUrl={playlist.imageUrl} />
            <strong>{playlist.name}</strong><small>By {playlist.owner}</small>
          </button>)}
        </div>
        {!loading && !error && !profile?.errors.playlists && !profile?.playlists.length ? <p className="browser-spotify-profile-empty">No playlists found.</p> : null}
      </section>
    </div>
  );
}
