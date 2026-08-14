# Designing printable parts with the Parametric CAD agent

Type `/agents:parametric-cad` in the Terminal or in a Garden chat, describe the
part, and send. The agent writes a parametric CAD program, builds it through a
real CAD kernel on your machine, measures the result, and gives you a design you
can turn, edit and print.

---

## What it is good at

Parts whose shape is described by dimensions and features:

brackets · plates · enclosures and lids · spacers · bushings · adapters ·
mounting-hole patterns · knobs · shafts · simple pulleys · boolean combinations
of boxes, cylinders and prisms · fillets and chamfers

It is not a sculptor. Organic shapes, artistic models, and anything you would
describe with adjectives rather than numbers are outside what it does. It also
does not do assemblies with moving joints, stress analysis, gear tooth
engineering, or production thread profiles.

---

## How to describe a part

Give it numbers. The agent will fill in anything you leave out and tell you what
it chose, but every number you state is one it does not have to guess.

> Create a wall-mounted Raspberry Pi enclosure. Internal dimensions
> 92 × 65 × 28 mm, 2.4 mm walls, four M3 heat-set insert bosses, a removable
> lid, 0.35 mm lid clearance, ventilation slots on both sides, and a USB-C
> opening centred 12 mm above the bottom.

Useful things to state:

- **Which dimensions are internal and which are external.** "92 mm inside" and
  "92 mm outside" are different parts.
- **Fasteners by size** — M3, M4 — rather than hole diameters. The agent knows
  the clearance, tap and heat-set insert sizes for M2 through M5.
- **Where a feature sits, and from what.** "12 mm above the bottom" is
  buildable; "near the bottom" is a guess.
- **What has to fit inside**, with its size.

Inline options, if you want them:

```
--fdm  --sla  --sls        the process the defaults come from (default: FDM)
--bed 250x250x300          your printer's build volume, in millimetres
--inch                     you work in inches; the geometry stays metric
--fresh                    start a new design instead of revising this chat's
```

---

## Clearances

Two printed parts that are drawn touching will fuse. A clearance is the gap you
leave so they do not.

| Fit | Gap | What it feels like |
| --- | --- | --- |
| Press fit | 0.15 mm | Needs a push; stays put |
| General fit | 0.30 mm | Drops in, no wobble |
| Sliding fit | 0.35 mm | Moves freely |

Those are the FDM defaults, for a well-tuned printer with a 0.4 mm nozzle. A
worn machine needs more; a resin printer needs about half. If a lid is too tight
or too loose, change the clearance parameter and rebuild — that is a one-number
edit, not a redesign.

---

## What you get back

A card appears in the chat while it works, then the design's own card below it.
Open it for:

**The 3D preview.** Drag to orbit, right-drag or shift-drag to pan, scroll to
zoom. Buttons give you the seven standard views, perspective or orthographic,
wireframe, the grid (labelled with its millimetre spacing), the bounding box,
and — on a multi-part design — a toggle per body so you can look inside a closed
enclosure.

**Assembly.** What the thing is, which printed body is which — each with the
size the kernel measured — the hardware you have to buy with its sizes and
quantities, and the ordered steps that say what attaches to what and with which
screw. A design of more than one body opens here, because a render shows shapes
and not intent. Parts the design only makes room for, such as the board or a
battery, are listed separately: it reserves their space, it does not print them.

**Parameters.** Every dimension the design depends on, named. Change one and
press *Rebuild with these values*: the part is rebuilt and re-validated on your
machine, and becomes a new revision. Nothing overwrites what you had.

**Validation.** The measured size, the number of bodies, volume, surface area,
whether each body is a valid closed solid, whether it fits your printer, the
tessellation tolerances the meshes were exported at, and every warning — shown
even when the files exported fine.

**Downloads.** STEP, STL, GLB, 3MF, the CAD source, the design specification and
the validation report.

**Revisions.** Every version, what changed, and which parameters moved.

If the model-written program cannot be completed, fails validation, or misses a
feature the product was required to have, Breadboard returns no CAD artifact and
keeps the concrete failure for diagnosis. It never substitutes a generic box,
mount, or product template. Retry or refine the request after addressing the
reported problem; an absent result is safer than a plausible-looking part that
does not implement the request.

---

## STEP or STL?

**STEP** is the real model: exact surfaces, editable in any CAD program, and the
one to keep. If you want to change the part properly later, this is the file.

**STL** and **3MF** are triangle meshes made *from* that model at a stated
tolerance. They are what a slicer reads. They cannot be turned back into an
editable design — a mesh has no idea that a hole was ever a hole.

**GLB** is the preview format. It is a mesh too, for viewers rather than
printers.

So: slice the STL, keep the STEP, and keep the CAD source if you ever want to
change the part the way the agent did.

---

## Changing a design

Just say what you want changed, in the same chat:

> Increase the wall thickness to 3 mm, change the mounting holes to M4, and move
> the USB opening 6 mm to the left.

The agent reads the design that is already there and modifies it — it does not
start over from your original sentence, so nothing you agreed earlier is
quietly lost. The result is a new revision; the previous one stays exactly where
it was. If you want a genuinely new part instead, add `--fresh`.

For a change that is only a number the design already exposes, the parameter
panel is faster than a message, and does the same thing.

---

## What validation does and does not check

It checks: at least one solid exists; the number of bodies matches the design;
each body is a valid OpenCascade shape; each body is watertight, so a slicer can
read it; no NaN or infinite coordinates; the measured size against the size the
design declared; minimum feature sizes; hole diameters; clearances; whether
bodies are disconnected; the exported mesh for holes, non-manifold edges and
degenerate triangles; and whether the part fits the configured print bed.

It does not check strength, stiffness, fatigue life, heat resistance, sealing,
or whether the part is a good idea. Wall thickness is checked against the value
the design declares, not by measuring the thinnest point of the real geometry —
a wall thinned by an unrelated cut would not be caught.

**A validated part is a geometrically sound part. It is not an engineered one.**

---

## Parts that need an engineer

The agent will still design geometry for these, but it says so plainly and
attaches an explicit notice rather than calling the result checked:

pressure or fluid containment · lifting and rigging · anything that carries a
person's weight or protects them in a fall · vehicle and aircraft control parts ·
medical devices · enclosures around mains wiring · sustained high temperature

The reason is the same in every case: those parts fail in ways nothing measured
here predicts, and they need a rated material, a real analysis, and physical
testing. A printed part is anisotropic — it is weakest along its layer lines,
which is exactly where a hobby-grade design does not expect it to break.

Weapons are outside what the agent designs at all.

---

## When it cannot help

If the local CAD service is not running, the agent says so in a second rather
than designing for two minutes and then failing. It normally starts with
everything else; if it has never been set up on this machine, run
`npm run setup:cad` once and start Breadboard again. If a build fails, the agent gets the exact error and
tries again, up to three times per message; if it still cannot produce a valid
solid it tells you what failed and what it would change, rather than handing you
a file that does not print.

---

## A prompt to start with

```
/agents:parametric-cad Create a wall-mounted Raspberry Pi enclosure. Internal
dimensions 92 × 65 × 28 mm, 2.4 mm walls, four M3 heat-set insert bosses, a
removable lid with 0.35 mm clearance, ventilation slots on both long sides, and
a USB-C opening 9 × 4 mm centred 12 mm above the inside floor on the front face.
```
