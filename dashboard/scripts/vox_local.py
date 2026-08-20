#!/usr/bin/env python3
"""
vox_local.py — Breadboard's driver for the Vox Director local engine.

The clone (`vox-director/`) ships the craft: the collage prompt composer
(`scripts/styles.py`), the element-level keyframe engine (`scripts/motion.py`),
the caption renderer (`scripts/text_overlay.py`), the Ken-Burns fallback
(`scripts/kenburns.py`) and the ffmpeg assembly (`scripts/assemble.py`). What it
does not ship is a way to drive any of that without a human placing every
keyframe by hand, and its automated path runs on a hosted API.

This file is the missing half, and nothing else. It imports the clone's modules
rather than copying them, so pulling the clone upgrades the look; it never
imports `provider.py` or `atlas_cloud.py`, which is where every hosted call
lives. There is no network access in any operation here.

Usage:  python vox_local.py <operation> <spec.json>

Every operation reads one JSON spec file, writes progress to stderr and one JSON
object to stdout. The caller (`dashboard/src/lib/vox-director/`) writes the spec
inside the run's own workspace and passes nothing else, so no model-authored
string ever reaches a command line.
"""

import json
import math
import os
import random
import subprocess
import sys

# --- the clone -------------------------------------------------------------


def clone_root():
    explicit = os.environ.get("VOX_DIRECTOR_ROOT", "").strip()
    if explicit and os.path.isdir(explicit):
        return os.path.abspath(explicit)
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, "..", ".."))
    return os.path.join(repo, "vox-director")


CLONE = clone_root()
SCRIPTS = os.path.join(CLONE, "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

import styles  # noqa: E402  (vox-director/scripts/styles.py)
import text_overlay  # noqa: E402  (vox-director/scripts/text_overlay.py)


# --- fonts -----------------------------------------------------------------
#
# The clone was written on macOS and only looks for fonts there, so on Windows
# every caption silently falls back to Pillow's 11px bitmap face. Extending the
# module's own search lists (rather than editing the clone) fixes captions, the
# ending title and the watermark in one place.

_BOLD_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\impact.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
_REGULAR_CANDIDATES = [
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]

text_overlay.FONT_BOLD = list(text_overlay.FONT_BOLD) + _BOLD_CANDIDATES
text_overlay.FONT_REG = list(text_overlay.FONT_REG) + _REGULAR_CANDIDATES


def bold_font(size):
    for path in list(text_overlay.FONT_BOLD):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


# --- containment -----------------------------------------------------------


class SpecError(RuntimeError):
    pass


def inside(root, candidate):
    """Every path in a spec resolves inside the run workspace, or the run stops.

    Element names, poster file names and beat ids all began as model output. A
    plan that asked to read `../../db/brain.db` is not a plan to sanitise; it is
    one to refuse.
    """
    root_abs = os.path.abspath(root)
    target = os.path.abspath(os.path.join(root_abs, candidate))
    if target != root_abs and not target.startswith(root_abs + os.sep):
        raise SpecError("path escapes the run workspace: %s" % candidate)
    return target


def require(spec, key):
    if key not in spec:
        raise SpecError("spec is missing %r" % key)
    return spec[key]


def note(message):
    print(message, file=sys.stderr, flush=True)


# --- colour ----------------------------------------------------------------
#
# A beat names its background in words ("bold flat deep-red paper"), which is
# what an image model wants. The title-card fallback has to paint it, so the
# words are read for the colours the clone's own theme presets use.

COLOR_WORDS = {
    "black": (26, 24, 22), "white": (247, 243, 235), "cream": (238, 228, 205),
    "ivory": (242, 235, 218), "kraft": (198, 170, 130), "sand": (216, 196, 160),
    "tan": (203, 173, 129), "beige": (226, 212, 184), "ochre": (196, 141, 46),
    "mustard": (214, 168, 44), "gold": (206, 165, 60), "amber": (214, 148, 38),
    "orange": (216, 106, 42), "rust": (166, 78, 42), "brick": (158, 66, 48),
    "red": (186, 52, 44), "crimson": (162, 38, 44), "vermilion": (206, 62, 40),
    "pink": (219, 112, 132), "magenta": (196, 60, 118), "purple": (108, 66, 128),
    "violet": (118, 82, 150), "indigo": (58, 62, 118), "navy": (34, 48, 82),
    "blue": (48, 90, 148), "cobalt": (32, 78, 158), "teal": (34, 110, 110),
    "cyan": (72, 152, 158), "mint": (146, 190, 168), "green": (66, 120, 74),
    "olive": (114, 118, 62), "avocado": (124, 130, 58), "forest": (44, 84, 58),
    "charcoal": (54, 52, 50), "grey": (128, 126, 122), "gray": (128, 126, 122),
    "slate": (94, 104, 112), "brown": (110, 78, 54), "sepia": (140, 110, 76),
    "clay": (176, 118, 88), "coral": (222, 118, 96), "lime": (168, 190, 72),
    "turquoise": (58, 158, 154), "maroon": (110, 40, 44), "plum": (108, 58, 78),
}

MODIFIERS = {
    "deep": 0.72, "dark": 0.68, "muted": 0.86, "pale": 1.24, "light": 1.22,
    "bright": 1.12, "aged": 0.9, "warm": 1.04, "soft": 1.1, "faded": 1.16,
}


def _mix(color, factor):
    if factor >= 1:
        return tuple(min(255, int(c + (255 - c) * (factor - 1))) for c in color)
    return tuple(max(0, int(c * factor)) for c in color)


def read_color(phrase, fallback=(196, 141, 46)):
    """The first colour word in a phrase, shaded by any modifier in front of it."""
    if not phrase:
        return fallback
    words = [w.strip(",.;:") for w in str(phrase).lower().replace("-", " ").split()]
    factor = 1.0
    for index, word in enumerate(words):
        if word in MODIFIERS:
            factor = MODIFIERS[word]
        if word in COLOR_WORDS:
            return _mix(COLOR_WORDS[word], factor)
        if index and words[index - 1] in MODIFIERS:
            factor = MODIFIERS[words[index - 1]]
    return fallback


def palette_colors(phrase, count=4):
    """Every colour named in a palette string, padded to `count`."""
    found = []
    words = [w.strip(",.;:") for w in str(phrase or "").lower().replace("-", " ").split()]
    factor = 1.0
    for word in words:
        if word in MODIFIERS:
            factor = MODIFIERS[word]
            continue
        if word in COLOR_WORDS:
            found.append(_mix(COLOR_WORDS[word], factor))
            factor = 1.0
    defaults = [(186, 52, 44), (214, 168, 44), (34, 110, 110), (238, 228, 205)]
    while len(found) < count:
        found.append(defaults[len(found) % len(defaults)])
    return found[:count]


def readable_ink(background):
    luminance = 0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]
    return (28, 22, 18) if luminance > 128 else (247, 241, 228)


# --- operations ------------------------------------------------------------


def op_themes(_spec):
    """The clone's own look library, so Breadboard never restates it."""
    return {
        "themes": styles.THEME_PRESETS,
        "styleLibrary": {name: text for name, text in styles.STYLE_LIBRARY.items()},
        "mechanics": styles.COLLAGE_MECHANICS,
        "defaultStyle": styles.DEFAULT_STYLE,
    }


def op_prompts(spec):
    """Compose every poster prompt with the clone's own composer.

    `styles.compose_collage_prompt` is the five-part structure from
    `references/prompt-guide.md` §1 — style block, scene as separate cut-outs,
    one bold flat background, baked headline, aspect. Calling it here rather
    than restating it in TypeScript is what keeps the look from drifting away
    from the clone as the clone is updated.
    """
    style = spec.get("style") or {}
    aspect = spec.get("aspect", "16:9")
    idiom = style.get("idiom") or styles.DEFAULT_STYLE
    prompts = []
    for shot in require(spec, "shots"):
        prompts.append({
            "key": str(shot.get("key", "")),
            "prompt": styles.compose_collage_prompt(
                scene=str(shot.get("scene", "")),
                title_cn="",
                title_en=str(shot.get("title", "")),
                bg=str(shot.get("background", "warm ochre")),
                aspect=aspect,
                with_title=bool(shot.get("withTitle", False)),
                style=idiom,
                palette=style.get("palette") or None,
                type_style=style.get("typeStyle") or None,
                finish=style.get("finish") or None,
            ),
        })
    return {"prompts": prompts}


def _torn_edge(draw, box, color, rng, teeth=26, amplitude=None):
    """A band of paper with a hand-torn bottom edge."""
    x0, y0, x1, y1 = box
    amplitude = amplitude if amplitude is not None else max(6, (y1 - y0) * 0.12)
    points = [(x0, y0), (x1, y0)]
    for index in range(teeth + 1):
        t = index / teeth
        x = x1 - (x1 - x0) * t
        points.append((x, y1 + rng.uniform(-amplitude, amplitude)))
    draw.polygon(points, fill=color)


def _halftone(canvas, box, color, rng, spacing=18, radius=4):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    y = y0
    row = 0
    while y < y1:
        x = x0 + (spacing // 2 if row % 2 else 0)
        while x < x1:
            r = radius * rng.uniform(0.55, 1.0)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color + (70,))
            x += spacing
        y += spacing
        row += 1
    canvas.alpha_composite(layer)


def _scrap(draw, cx, cy, size, color, rng):
    kind = rng.choice(["triangle", "circle", "zigzag", "square"])
    if kind == "circle":
        draw.ellipse([cx - size, cy - size, cx + size, cy + size], fill=color)
    elif kind == "triangle":
        draw.polygon(
            [(cx, cy - size), (cx + size, cy + size), (cx - size, cy + size)], fill=color
        )
    elif kind == "square":
        draw.polygon(
            [(cx - size, cy - size * 0.8), (cx + size, cy - size),
             (cx + size * 0.9, cy + size), (cx - size, cy + size * 0.85)], fill=color
        )
    else:
        step = size / 2
        points = []
        for index in range(6):
            points.append((cx - size + index * step * 0.7, cy + (step if index % 2 else -step)))
        draw.line(points, fill=color, width=max(3, int(size * 0.25)))


def _fit_headline(text, font_path_size, max_width, draw):
    """Shrink a headline until it fits, then wrap what is still too long."""
    size = font_path_size
    while size > 18:
        font = bold_font(size)
        words = text.split()
        lines, current = [], ""
        for word in words:
            trial = (current + " " + word).strip()
            if draw.textlength(trial, font=font) <= max_width or not current:
                current = trial
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        if all(draw.textlength(line, font=font) <= max_width for line in lines) and len(lines) <= 3:
            return font, lines
        size = int(size * 0.86)
    font = bold_font(size)
    return font, [text]


def op_posters(spec):
    """Deterministic paper-collage title cards.

    The fallback when ComfyUI cannot draw, and what `--no-images` asks for on
    purpose. It is not a generated poster and does not pretend to be one, but it
    keeps the collage vocabulary — flat bold ground, a torn band, halftone, tape,
    paper scraps, a cut-out headline — so the film still reads as one piece.
    Seeded from the run's seed and the shot key, so the same production renders
    the same cards every time.
    """
    root = require(spec, "root")
    out_dir = inside(root, require(spec, "outDir"))
    os.makedirs(out_dir, exist_ok=True)
    width = int(spec.get("width", 1280))
    height = int(spec.get("height", 720))
    style = spec.get("style") or {}
    accents = palette_colors(style.get("palette"), 4)
    base_seed = int(spec.get("seed") or 0)

    made = []
    for shot in require(spec, "shots"):
        key = str(shot.get("key", "card"))
        rng = random.Random("%s:%s" % (base_seed, key))
        background = read_color(shot.get("background"), accents[0])
        ink = readable_ink(background)
        canvas = Image.new("RGBA", (width, height), background + (255,))
        draw = ImageDraw.Draw(canvas)

        # Aged paper grain: a light wash of speckle so the ground is not flat ink.
        grain = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(grain)
        for _ in range(int(width * height / 5200)):
            x, y = rng.uniform(0, width), rng.uniform(0, height)
            shade = rng.choice([(255, 255, 255, 22), (0, 0, 0, 20)])
            gdraw.ellipse([x, y, x + rng.uniform(1, 3), y + rng.uniform(1, 3)], fill=shade)
        canvas.alpha_composite(grain)

        _halftone(canvas, (width * 0.55, height * 0.05, width * 1.02, height * 0.55),
                  accents[2 % len(accents)], rng, spacing=int(height / 26) + 8)

        # Two paper layers, each with its own torn edge and drop shadow.
        for index, box in enumerate([
            (-width * 0.05, height * 0.08, width * 0.72, height * 0.34),
            (width * 0.06, height * 0.30, width * 1.05, height * 0.44),
        ]):
            layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            ldraw = ImageDraw.Draw(layer)
            _torn_edge(ldraw, box, accents[(index + 1) % len(accents)] + (255,), rng)
            shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            shadow.paste((0, 0, 0, 90), (0, 0), layer.split()[3])
            canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(7)), (5, 9))
            canvas.alpha_composite(layer)

        for _ in range(rng.randint(3, 5)):
            _scrap(
                draw,
                rng.uniform(width * 0.08, width * 0.94),
                rng.uniform(height * 0.52, height * 0.94),
                rng.uniform(height * 0.03, height * 0.08),
                accents[rng.randrange(len(accents))] + (235,),
                rng,
            )

        # Tape corners.
        for corner in [(width * 0.08, height * 0.10), (width * 0.86, height * 0.40)]:
            tape = Image.new("RGBA", (int(width * 0.11), int(height * 0.05)), (250, 244, 214, 150))
            tape = tape.rotate(rng.uniform(-22, 22), expand=True, resample=Image.BICUBIC)
            canvas.alpha_composite(tape, (int(corner[0]), int(corner[1])))

        headline = str(shot.get("title") or "").strip().upper()
        title_box = None
        if shot.get("withTitle") and headline:
            font, lines = _fit_headline(headline, int(height * 0.155), width * 0.78, draw)
            block = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            bdraw = ImageDraw.Draw(block)
            line_height = int(font.size * 1.12)
            top = int(height * 0.155 - (len(lines) - 1) * line_height * 0.5)
            y = top
            widest = 0
            for line in lines:
                run = bdraw.textlength(line, font=font)
                widest = max(widest, run)
                x = (width - run) / 2
                bdraw.text((x, y), line, font=font, fill=ink + (255,),
                           stroke_width=max(3, int(font.size * 0.07)),
                           stroke_fill=readable_ink(ink) + (255,))
                y += line_height
            block = block.rotate(rng.uniform(-2.2, 2.2), resample=Image.BICUBIC)
            canvas.alpha_composite(block)
            # On the 0-1000 grid, with room for the stroke and the tilt. This is
            # the box the motion stage has to cut: a headline cut in half leaves
            # its other line blurred on the backdrop, reading as a ghost.
            pad = line_height * 0.5
            title_box = [
                round(max(0, ((width - widest) / 2 - pad) / width * 1000)),
                round(max(0, (top - pad) / height * 1000)),
                round(min(1000, ((width + widest) / 2 + pad) / width * 1000)),
                round(min(1000, (y + pad) / height * 1000)),
            ]
        else:
            # A detail cut-in carries no headline; a small paper sticker marks it.
            sticker = Image.new("RGBA", (int(width * 0.16), int(height * 0.05)),
                                accents[3 % len(accents)] + (240,))
            sticker = sticker.rotate(rng.uniform(-8, 8), expand=True, resample=Image.BICUBIC)
            canvas.alpha_composite(sticker, (int(width * 0.07), int(height * 0.83)))

        out_path = os.path.join(out_dir, "poster_%s.png" % _safe_name(key))
        canvas.convert("RGB").save(out_path)
        made.append({"key": key, "path": out_path, "width": width, "height": height,
                     "titleBox": title_box})
        note("poster %s" % key)

    return {"posters": made}


def _safe_name(value):
    keep = [c if (c.isalnum() or c in "-_") else "-" for c in str(value)]
    return ("".join(keep)[:48] or "shot")


def _local_cutout(crop):
    """Key a poster's flat paper ground to alpha, with no network and no model.

    Upstream cuts elements with a hosted background-removal model. That is the
    one piece of the local path that cannot be reproduced offline, but the thing
    being cut out here is a paper collage on a *bold flat colour*, which a
    flood fill from the corners separates well. When it does not — when the fill
    takes almost nothing or almost everything — the caller is told, and the
    element degrades to a plain crop rather than becoming a hole in the frame.
    """
    rgb = crop.convert("RGB")
    width, height = rgb.size
    sentinel = (255, 0, 255)
    marked = rgb.copy()
    for corner in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
        try:
            ImageDraw.floodfill(marked, corner, sentinel, thresh=46)
        except ValueError:
            continue
    mask = Image.new("L", (width, height), 255)
    mask_pixels = mask.load()
    marked_pixels = marked.load()
    removed = 0
    for y in range(height):
        for x in range(width):
            if marked_pixels[x, y] == sentinel:
                mask_pixels[x, y] = 0
                removed += 1
    fraction = removed / float(width * height)
    if fraction < 0.03 or fraction > 0.9:
        return None, fraction
    element = crop.convert("RGBA")
    element.putalpha(mask.filter(ImageFilter.GaussianBlur(1.2)))
    return element, fraction


def op_elements(spec):
    """Cut a poster into the pieces the motion engine animates.

    Writes `elements_spec.json` in the clone's own format alongside the pieces,
    so a production made here can be picked up by `extract_elements.py` and
    `motion.py` by hand exactly as upstream documents.
    """
    root = require(spec, "root")
    poster = inside(root, require(spec, "poster"))
    out_dir = inside(root, require(spec, "outDir"))
    os.makedirs(out_dir, exist_ok=True)
    card = Image.open(poster).convert("RGBA")
    width, height = card.size

    results = []
    spec_elements = []
    for element in require(spec, "elements"):
        name = _safe_name(element.get("name", "piece"))
        x0, y0, x1, y1 = [float(v) for v in element["bbox"]]
        box = (
            max(0, int(x0 / 1000.0 * width)),
            max(0, int(y0 / 1000.0 * height)),
            min(width, int(x1 / 1000.0 * width)),
            min(height, int(y1 / 1000.0 * height)),
        )
        if box[2] - box[0] < 8 or box[3] - box[1] < 8:
            results.append({"name": name, "skipped": "the element box is too small to cut"})
            continue
        crop = card.crop(box)
        mode = element.get("mode", "crop")
        effective = "crop"
        detail = ""
        piece = crop.convert("RGBA")
        if mode == "cutout":
            cut, fraction = _local_cutout(crop)
            if cut is not None:
                piece = cut
                effective = "cutout"
            else:
                detail = (
                    "the local cutout removed %.0f%% of the box, which is not a "
                    "silhouette, so the piece was kept as a crop" % (fraction * 100)
                )
        out_path = os.path.join(out_dir, "%s.png" % name)
        piece.save(out_path)
        results.append({
            "name": name,
            "path": out_path,
            "mode": mode,
            "effectiveMode": effective,
            "note": detail,
            "center": [(box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0],
            "size": [box[2] - box[0], box[3] - box[1]],
            "box": list(box),
        })
        spec_elements.append({
            "name": name, "bbox": list(box), "mode": mode, "file": out_path,
            "size": [box[2] - box[0], box[3] - box[1]],
        })
        note("element %s (%s)" % (name, effective))

    # The backdrop: the original poster with each landing zone blurred, which is
    # the fix `references/local-engine.md` settles on — dimming leaves a visible
    # patch, blurring keeps luminance and colour and lets the sharp piece fly in
    # to "focus" its own spot.
    backdrop = card.copy()
    if results:
        blurred = card.filter(ImageFilter.GaussianBlur(max(6, int(min(width, height) / 90))))
        mask = Image.new("L", (width, height), 0)
        mdraw = ImageDraw.Draw(mask)
        for item in results:
            if "box" not in item:
                continue
            mdraw.rounded_rectangle(item["box"], radius=int(min(width, height) * 0.02), fill=255)
        backdrop.paste(blurred, (0, 0), mask.filter(ImageFilter.GaussianBlur(10)))
    backdrop_path = os.path.join(out_dir, "backdrop.png")
    backdrop.convert("RGB").save(backdrop_path)

    with open(os.path.join(out_dir, "elements_spec.json"), "w", encoding="utf-8") as handle:
        json.dump({"card": poster, "elements": spec_elements}, handle, ensure_ascii=False, indent=2)

    return {"elements": results, "backdrop": backdrop_path,
            "poster": {"width": width, "height": height}}


def op_motion(spec):
    """Animate one poster's pieces with the clone's own keyframe engine.

    Every easing, entrance helper, breathing wobble, confetti field, starburst
    and camera impact comes from `vox-director/scripts/motion.py`. What this adds
    is the layout — which upstream leaves to a person with a labelled grid, and
    which the planning stage now derives per poster.
    """
    import motion  # vox-director/scripts/motion.py

    root = require(spec, "root")
    backdrop_path = inside(root, require(spec, "backdrop"))
    out_path = inside(root, require(spec, "out"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    width = int(spec.get("width", 1280))
    height = int(spec.get("height", 720))
    fps = int(spec.get("fps", 24))
    seconds = max(0.6, min(12.0, float(spec.get("seconds", 5))))
    poster_width = float(spec.get("posterWidth", width)) or float(width)
    scale = width / poster_width

    backdrop = Image.open(backdrop_path).convert("RGBA").resize((width, height))

    layers = []
    impacts = []
    for element in spec.get("elements", []):
        path = inside(root, element["path"])
        cx = float(element["center"][0]) * scale
        cy = float(element["center"][1]) * (height / float(spec.get("posterHeight", height) or height))
        start = max(0.0, min(seconds - 0.25, float(element.get("start", 0))))
        entrance = element.get("entrance", "pop_settle")
        spin = float(element.get("spin", 0))
        if entrance == "fly_in":
            keys = motion.fly_in(start, cx, cy, width, height,
                                 frm=element.get("from", "R"), spin=spin, dur=0.7, s=scale)
        elif entrance == "slap":
            keys = motion.slap(start, cx, cy, s=scale)
        elif entrance == "drop":
            keys = motion.drop(start, cx, cy, height, s=scale)
        else:
            keys = motion.pop_settle(start, cx, cy, s=scale, spin=spin)
        layers.append(motion.Layer(path, keys, sway=0.5, pulse=0.003))
        impacts.append(start + 0.45)

    confetti = motion.Confetti(width, height, n=28) if spec.get("confetti") else None
    zoom_to = max(1.0, min(1.3, float(spec.get("cameraZoom", 1.06))))
    shake = bool(spec.get("cameraShake", True))
    starburst = bool(spec.get("starburst"))

    def camera(t):
        z = 1.0 + (zoom_to - 1.0) * (t / seconds)
        sx = sy = 0.0
        if shake:
            for hit in impacts[:6]:
                if t >= hit:
                    d = t - hit
                    amplitude = 18 * math.exp(-8 * d)
                    sx += amplitude * math.sin(d * 60)
                    sy += amplitude * math.cos(d * 55)
        return z, sx, sy

    encoder = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", "%dx%d" % (width, height), "-r", str(fps), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out_path],
        stdin=subprocess.PIPE,
    )
    frames = int(seconds * fps)
    dt = 1.0 / fps
    try:
        for index in range(frames):
            t = index * dt
            canvas = backdrop.copy()
            if starburst and t > 0.2:
                # Half the frame rather than upstream's full-bleed default, and
                # composited at a third of its opacity: it is a glow behind the
                # collage, and at its own size it buried every piece in front.
                accent = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
                motion.starburst(accent, width * 0.5, height * 0.45, t,
                                 R=int(max(width, height) * 0.42))
                alpha = accent.split()[3].point(lambda v: int(v * 0.35))
                accent.putalpha(alpha)
                canvas.alpha_composite(accent)
            for layer in layers:
                layer.draw(canvas, t)
            if confetti:
                confetti.draw(canvas, t, dt)
            z, sx, sy = camera(t)
            frame = canvas.convert("RGB")
            zw, zh = max(width, int(width * z)), max(height, int(height * z))
            frame = frame.resize((zw, zh), Image.LANCZOS)
            cx = max(0, min(zw - width, (zw - width) // 2 + int(sx)))
            cy = max(0, min(zh - height, (zh - height) // 2 + int(sy)))
            frame = frame.crop((cx, cy, cx + width, cy + height))
            encoder.stdin.write(frame.tobytes())
    finally:
        try:
            encoder.stdin.close()
        except (BrokenPipeError, ValueError):
            pass
        encoder.wait()
    if encoder.returncode != 0:
        raise SpecError("ffmpeg exited %s while encoding the motion clip" % encoder.returncode)
    return {"out": out_path, "frames": frames, "seconds": seconds}


def _ff(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def op_kenburns(spec):
    """The clone's pure-ffmpeg fallback: a blurred cover behind a slow push."""
    root = require(spec, "root")
    poster = inside(root, require(spec, "poster"))
    out_path = inside(root, require(spec, "out"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    width = int(spec.get("width", 1280))
    height = int(spec.get("height", 720))
    fps = int(spec.get("fps", 24))
    seconds = max(0.6, min(12.0, float(spec.get("seconds", 5))))
    frames = int(seconds * fps)
    zoom_in = bool(spec.get("zoomIn", True))
    z = "min(zoom+0.0009,1.18)" if zoom_in else "if(eq(on,1),1.18,max(zoom-0.0009,1.0))"
    chain = (
        "[0:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,"
        "boxblur=26:2,eq=brightness=-0.05[bg];"
        "[0:v]scale=%d:%d:force_original_aspect_ratio=decrease[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,scale=%d:%d,"
        "zoompan=z='%s':d=%d:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=%dx%d:fps=%d[v]"
        % (width, height, width, height, width, height, width * 2, height * 2,
           z, frames, width, height, fps)
    )
    _ff(["-loop", "1", "-i", poster, "-filter_complex", chain, "-map", "[v]",
         "-t", "%.3f" % seconds, "-c:v", "libx264", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", out_path])
    return {"out": out_path, "seconds": seconds}


def op_scrapbook(spec):
    """The clone's lighter assembler: a tilted card on a cream desk."""
    root = require(spec, "root")
    poster = inside(root, require(spec, "poster"))
    out_path = inside(root, require(spec, "out"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    width = int(spec.get("width", 1280))
    height = int(spec.get("height", 720))
    fps = int(spec.get("fps", 24))
    seconds = max(0.6, min(12.0, float(spec.get("seconds", 5))))
    tilt = max(-8.0, min(8.0, float(spec.get("tilt", -2.5))))
    radians = math.radians(tilt)
    cream = "0xE9E1D0"
    chain = (
        "color=c=%s:s=%dx%d:d=%.3f:r=%d,format=rgb24[bg];"
        "[0:v]scale=%d:-1:flags=lanczos,format=rgba,"
        "rotate=%.4f:c=none:ow=rotw(%.4f):oh=roth(%.4f),fps=%d[c];"
        "[bg][c]overlay=(W-w)/2:(H-h)/2,setsar=1,"
        "zoompan=z='min(zoom+0.0006,1.10)':d=%d:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        "s=%dx%d:fps=%d,format=yuv420p[v]"
        % (cream, width, height, seconds, fps, int(width * 0.84),
           radians, radians, radians, fps, int(seconds * fps), width, height, fps)
    )
    _ff(["-loop", "1", "-i", poster, "-filter_complex", chain, "-map", "[v]",
         "-t", "%.3f" % seconds, "-c:v", "libx264", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", out_path])
    return {"out": out_path, "seconds": seconds}


def op_still(spec):
    """The last fallback: the poster held, letterboxed onto its own blur."""
    root = require(spec, "root")
    poster = inside(root, require(spec, "poster"))
    out_path = inside(root, require(spec, "out"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    width = int(spec.get("width", 1280))
    height = int(spec.get("height", 720))
    fps = int(spec.get("fps", 24))
    seconds = max(0.6, min(12.0, float(spec.get("seconds", 5))))
    chain = (
        "[0:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,boxblur=26:2[bg];"
        "[0:v]scale=%d:%d:force_original_aspect_ratio=decrease[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=%d,format=yuv420p[v]"
        % (width, height, width, height, width, height, fps)
    )
    _ff(["-loop", "1", "-i", poster, "-filter_complex", chain, "-map", "[v]",
         "-t", "%.3f" % seconds, "-c:v", "libx264", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", out_path])
    return {"out": out_path, "seconds": seconds}


def op_silence(spec):
    """A silent bed, so `--no-music` runs the same assembly as everything else.

    `assemble.py` always lays a music track under the narration and ducks it.
    Handing it silence is honest — the film has no music — and keeps one code
    path instead of a second, less-tested assembly for the no-music case.
    """
    root = require(spec, "root")
    out_path = inside(root, require(spec, "out"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    seconds = max(1.0, min(600.0, float(spec.get("seconds", 30))))
    _ff(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
         "-t", "%.3f" % seconds, "-c:a", "pcm_s16le", out_path])
    return {"out": out_path, "seconds": seconds}


def op_assemble(spec):
    """The final render, through the clone's own assembly stage.

    `vox-director/scripts/assemble.py` normalises every shot, concatenates them,
    lays each beat's narration at its own start, ducks the music beneath it with
    a sidechain compressor, burns the captions Pillow rendered and writes an
    H.264 MP4. Breadboard writes the `beats.json` it reads and moves the result
    into `out/`, and nothing about the craft is restated here.
    """
    import assemble  # vox-director/scripts/assemble.py

    root = require(spec, "root")
    project = inside(root, spec.get("projectDir", "."))
    assemble.run(project)
    produced = os.path.join(project, "final.mp4")
    if not os.path.exists(produced):
        raise SpecError("the assembly stage produced no final.mp4")
    out_dir = os.path.join(project, "out")
    os.makedirs(out_dir, exist_ok=True)
    final = os.path.join(out_dir, "final.mp4")
    if os.path.exists(final):
        os.remove(final)
    os.replace(produced, final)
    return {"final": final, **_probe(final)}


def _probe(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,codec_name",
         "-show_entries", "format=duration,size", "-of", "json", path],
        capture_output=True, text=True,
    )
    try:
        data = json.loads(probe.stdout or "{}")
    except ValueError:
        data = {}
    stream = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    return {
        "duration": float(fmt.get("duration") or 0),
        "size": int(fmt.get("size") or 0),
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "codec": stream.get("codec_name") or "",
    }


def op_probe(spec):
    root = require(spec, "root")
    return _probe(inside(root, require(spec, "path")))


OPERATIONS = {
    "themes": op_themes,
    "prompts": op_prompts,
    "posters": op_posters,
    "elements": op_elements,
    "motion": op_motion,
    "kenburns": op_kenburns,
    "scrapbook": op_scrapbook,
    "still": op_still,
    "silence": op_silence,
    "assemble": op_assemble,
    "probe": op_probe,
}


def main(argv):
    if len(argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: vox_local.py <operation> <spec.json>"}))
        return 2
    operation = argv[0]
    if operation not in OPERATIONS:
        print(json.dumps({"ok": False, "error": "unknown operation %r" % operation}))
        return 2
    try:
        with open(argv[1], encoding="utf-8") as handle:
            spec = json.load(handle)
    except (OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": "unreadable spec: %s" % error}))
        return 2
    try:
        result = OPERATIONS[operation](spec)
    except SpecError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1
    except Exception as error:  # noqa: BLE001 - the caller turns this into a run failure
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": "%s: %s" % (type(error).__name__, error)}))
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
