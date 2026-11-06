import fs from "node:fs";
import path from "node:path";

/**
 * Give torchcodec a set of FFmpeg shared libraries it can actually bind to.
 *
 * WhisperX decodes audio through torchcodec, whose `libtorchcodec_core7.dll`
 * imports `avcodec-61.dll`, `avformat-61.dll`, `avutil-59.dll`, `avfilter-10.dll`,
 * `swresample-5.dll` and `swscale-8.dll` by those exact names. Nothing in the
 * bundle provided them: `resources/bin` ships a *static* ffmpeg.exe, which has no
 * DLLs to link against. torchcodec then failed to load, torchaudio 2.8 has no
 * other backend, and every waveform came back as digital silence — so Pyannote
 * logged "No active speech found in audio", the job reached `completed`, and the
 * transcript was empty. It never raised, so callers just saw "no speech".
 *
 * The venv already contains those libraries: PyAV vendors FFmpeg 7.1 in
 * `av.libs`. They are unusable as-is because delvewheel renames every file to
 * `NAME-<32 hex>.dll` to keep wheels from colliding. So we hard-link each one
 * back to its canonical name in a sibling `ffmpeg-shared` directory.
 *
 * The directory has to be registered with `os.add_dll_directory`, not PATH:
 * since Python 3.8 PATH is ignored for extension-module dependency resolution
 * (verified — putting both directories on PATH changes nothing). A `.pth` file
 * is the only hook that runs early enough, before torchcodec is imported. Both
 * directories are registered: `ffmpeg-shared` for the canonical names torchcodec
 * asks for, `av.libs` because those libraries' own import tables still reference
 * each other by the mangled names.
 *
 * Hard links keep this free — the ~78 MB of libraries is not duplicated.
 *
 * Scriberr provisions this venv lazily on first use, so a fresh install or a
 * rebuilt speech environment arrives without the fix. Re-running this on every
 * desktop start is what stops that from silently regressing into empty
 * transcripts again.
 */

const MANGLED_SUFFIX = /^(.+)-[0-9a-f]{32}$/;

const PTH_NAME = "zz-torchcodec-ffmpeg.pth";
const SHIM_DIR = "ffmpeg-shared";
const AV_LIBS = "av.libs";
/**
 * One line, because site.py executes each `.pth` line separately. It also runs
 * them with split globals/locals, which is why this avoids a comprehension —
 * a comprehension body cannot see names bound earlier on the same line.
 *
 * `torch/lib` is registered for a second, unrelated loader: ctranslate2
 * (faster-whisper's backend, which is how WhisperX actually transcribes)
 * bundles the cuDNN 9 *dispatcher* `cudnn64_9.dll` but none of the
 * sub-libraries that dispatcher loads by name, so a CUDA job died with
 * "Could not locate cudnn_ops64_9.dll" and aborted the process (0xc0000409)
 * after the media had already been downloaded. The Windows PyTorch CUDA wheel
 * ships those DLLs — plus the cuBLAS ctranslate2 also links — in `torch/lib`,
 * so pointing at that directory is the whole fix: nothing extra is installed
 * and nothing is copied.
 */
const PTH_LINE =
  "import os, sys; " +
  `_p = os.path.join(sys.prefix, 'Lib', 'site-packages'); ` +
  `_a = os.path.join(_p, '${SHIM_DIR}'); ` +
  `_c = os.path.join(_p, '${AV_LIBS}'); ` +
  `_t = os.path.join(_p, 'torch', 'lib'); ` +
  "os.path.isdir(_a) and os.add_dll_directory(_a); " +
  "os.path.isdir(_c) and os.add_dll_directory(_c); " +
  "os.path.isdir(_t) and os.add_dll_directory(_t)\n";

export interface WhisperXFfmpegRepairResult {
  applied: boolean;
  reason: string;
  linked: number;
}

export function repairWhisperXFfmpeg(scriberrDataDir: string): WhisperXFfmpegRepairResult {
  if (process.platform !== "win32") {
    return { applied: false, reason: "not-windows", linked: 0 };
  }

  const sitePackages = path.join(
    scriberrDataDir,
    "models",
    "WhisperX",
    ".venv",
    "Lib",
    "site-packages",
  );
  const avLibs = path.join(sitePackages, AV_LIBS);
  // Both are absent until Scriberr has provisioned the speech environment.
  if (!fs.existsSync(avLibs)) {
    return { applied: false, reason: "whisperx-env-not-provisioned", linked: 0 };
  }

  const shim = path.join(sitePackages, SHIM_DIR);
  let linked = 0;
  try {
    fs.mkdirSync(shim, { recursive: true });

    for (const entry of fs.readdirSync(avLibs)) {
      if (!entry.toLowerCase().endsWith(".dll")) continue;
      const stem = entry.slice(0, -4);
      const match = MANGLED_SUFFIX.exec(stem);
      const canonical = match ? `${match[1]}.dll` : entry;
      const dest = path.join(shim, canonical);
      if (fs.existsSync(dest)) continue;
      const src = path.join(avLibs, entry);
      try {
        fs.linkSync(src, dest);
      } catch {
        // Different volume or a filesystem without hard links: a copy works too.
        fs.copyFileSync(src, dest);
      }
      linked += 1;
    }

    const pth = path.join(sitePackages, PTH_NAME);
    const current = fs.existsSync(pth) ? fs.readFileSync(pth, "utf8") : null;
    if (current !== PTH_LINE) {
      fs.writeFileSync(pth, PTH_LINE, "utf8");
    }
  } catch (error) {
    // Transcription is optional; never let this block startup.
    return {
      applied: false,
      reason: `failed: ${(error as Error).message}`,
      linked,
    };
  }

  return { applied: true, reason: "ok", linked };
}
