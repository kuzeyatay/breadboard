"""The built-in optimizer: two small programs on this server, nothing leaves it.

* JPG: mozjpeg's `cjpeg` encodes the page again from the lossless PNG it was drawn as, at the same quality
  (about 19% smaller at quality 90 and below; above 90 it gains nothing, so Pillow's file is kept).
* PNG: `oxipng -o 2` recompresses losslessly (14-22% smaller, the pixels stay the same).
* WebP and AVIF: Pillow's files are already as small as these tools make them (benchmark on #133), so they are
  left as they are.

The Docker image installs both programs (`INSTALL_IMAGE_OPTIMIZERS`); where one is missing, its format is
left as Pillow made it. Each run gets its own work directory, deleted afterwards.
"""

from __future__ import annotations

import functools
import io
import shutil
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from PIL import Image

from ..renderer import _new_workdir
from .base import Job, OptimizerError, left

MOZJPEG_MAX_QUALITY = 90  # above this mozjpeg's files are no smaller than Pillow's
OXIPNG_LEVEL = 2
OXIPNG_THREADS = 2


@functools.cache
def cjpeg() -> str | None:
    """The path of mozjpeg's `cjpeg`, or None (libjpeg's own `cjpeg` doesn't count: it is no smaller)."""
    path = shutil.which("cjpeg")
    if path is None:
        return None
    try:
        answer = subprocess.run([path, "-version"], capture_output=True, timeout=5, check=False)  # noqa: S603
    except (OSError, subprocess.SubprocessError):
        return None
    return path if b"mozjpeg" in (answer.stdout + answer.stderr).lower() else None


@functools.cache
def oxipng() -> str | None:
    return shutil.which("oxipng")


class Builtin:
    id = "builtin"
    name = "Built-in"
    sends_offsite = False

    @property
    def formats(self) -> tuple[str, ...]:
        return (*(("jpg",) if cjpeg() else ()), *(("png",) if oxipng() else ()))

    def ready(self) -> bool:
        return bool(self.formats)

    def shrink(self, job: Job, deadline: float) -> bytes:
        if job.format == "jpg":
            return self._jpg(job, deadline)
        return self._png(job, deadline)

    def _jpg(self, job: Job, deadline: float) -> bytes:
        # cjpeg writes no metadata and no colour profile: only when the export leaves both out.
        if (
            job.source is None
            or (job.quality or 100) > MOZJPEG_MAX_QUALITY
            or not (job.strip_metadata and job.srgb)
        ):
            return job.data
        with Image.open(io.BytesIO(job.source)) as source:
            image = source.convert("RGBA")
        flat = Image.new("RGBA", image.size, (255, 255, 255, 255))  # as the export flattens a JPG
        flat.alpha_composite(image)
        with _workdir() as workdir:
            flat.convert("RGB").save(workdir / "in.ppm", "PPM")
            command = [cjpeg(), "-quality", str(job.quality), "-outfile", str(workdir / "out.jpg")]
            if not job.progressive:
                command.append("-baseline")
            _run([*command, str(workdir / "in.ppm")], workdir, deadline)
            return (workdir / "out.jpg").read_bytes()

    def _png(self, job: Job, deadline: float) -> bytes:
        with _workdir() as workdir:
            (workdir / "in.png").write_bytes(job.data)
            command = [oxipng(), "-q", "-o", str(OXIPNG_LEVEL), "-t", str(OXIPNG_THREADS)]
            if job.strip_metadata:
                command += ["--strip", "safe"]  # what doesn't change how the image looks
            _run([*command, "--out", str(workdir / "out.png"), str(workdir / "in.png")], workdir, deadline)
            return (workdir / "out.png").read_bytes()


@contextmanager
def _workdir() -> Iterator[Path]:
    path = _new_workdir()
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _run(command: list[str], workdir: Path, deadline: float) -> None:
    try:
        done = subprocess.run(  # noqa: S603 - our own program and work directory, no shell
            command, cwd=workdir, capture_output=True, timeout=left(deadline), check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise OptimizerError("It took too long.") from exc
    except OSError as exc:
        raise OptimizerError(f"{Path(command[0]).name} could not be started.") from exc
    if done.returncode != 0:
        raise OptimizerError(f"{Path(command[0]).name} failed.")
