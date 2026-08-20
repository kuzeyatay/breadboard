// The `beats.json` Breadboard hands to the clone's own stages.
//
// This is the seam that makes the integration a use of upstream rather than a
// rewrite of it: `vox-director/scripts/assemble.py` and `kenburns.py` open this
// file, and a production made in Breadboard can be dropped into
// `vox-director/out/<project>/` and driven by hand from there exactly as
// `SKILL.md` documents.
//
// Kept in its own module, importing nothing but the workspace and the types, so
// the document's shape can be tested without dragging a Voicebox client and a
// database into the test process.

import { resolveInWorkspace, writeJsonFile } from "./workspace.ts";
import type { VoxProduction } from "./types.ts";

/**
 * Write the `beats.json` the clone's own stages read.
 *
 * This is the seam that makes the integration a use of upstream rather than a
 * rewrite of it: `assemble.py` and `kenburns.py` open this file, and a
 * production made in Breadboard can be dropped into `vox-director/out/` and
 * driven by hand from here exactly as `SKILL.md` documents.
 */
export function writeUpstreamBeatsDocument(
  runId: string,
  production: VoxProduction,
  musicRelativePath: string,
): string {
  const absolute = (relative: string) => resolveInWorkspace(runId, relative);
  const document = {
    project: production.id,
    topic: production.brief,
    language: production.language,
    aspect: production.aspectRatio,
    style: "collage",
    // Deliberately not "atlas_cloud": nothing in this pipeline calls a provider,
    // and a document that said otherwise would be a lie to whoever picks it up.
    provider: "none",
    theme: production.style.theme,
    arc: production.arc,
    collage_style: production.style.idiom,
    motion_style: production.style.motionStyle,
    caption_style: production.style.captionStyle,
    captions: true,
    // Upstream defaults this to "Made with Atlas Cloud · vox-director"; nothing
    // here was made with Atlas Cloud, and Breadboard does not brand a person's
    // own video, so it is empty.
    watermark: "",
    mix: { music: 0.6, voice: 1.25 },
    bgm_path: absolute(musicRelativePath),
    beats: production.beats
      .filter((beat) => beat.shots.some((shot) => shot.clipRelativePath))
      .map((beat) => ({
        id: beat.id,
        title_en: beat.title,
        title_cn: "",
        bg: beat.background,
        feel: beat.feel,
        hook: beat.hook,
        narration: beat.narration,
        narration_audio: beat.narrationRelativePath ? absolute(beat.narrationRelativePath) : "",
        narration_dur: beat.narrationSeconds,
        shots: beat.shots
          .filter((shot) => shot.clipRelativePath)
          .map((shot) => ({
            id: shot.id,
            dur: shot.duration,
            title: shot.title,
            shot_size: shot.shotSize,
            camera_move: shot.cameraMove,
            scene: shot.scene,
            element_motion: shot.elementMotion,
            keyframe_path: shot.poster ? absolute(shot.poster.relativePath) : "",
            clip_path: absolute(shot.clipRelativePath as string),
          })),
      })),
  };
  return writeJsonFile(runId, "beats.json", document);
}
