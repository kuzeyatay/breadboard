---
title: "Capacitor Illustration of Displacement Current"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "capacitor-illustration-of-displacement-current"
locations: ["Page 300", "Page 301", "Page 302"]
related: ["displacement-current-from-charge-continuity", "maxwell-equations-in-integral-form-and-field-boundaries", "maxwell-equations-and-supporting-constitutive-relations"]
---

## ConceptNode: Capacitor Illustration of Displacement Current

Planning node for [[capacitor-illustration-of-displacement-current|1.146 Capacitor Illustration of Displacement Current]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 300, Page 301, Page 302

The parallel-plate capacitor example explains why displacement current is necessary for a surface-independent application of Ampère's circuital law. A filamentary loop containing a capacitor is driven by an induced emf $V_0\cos\omega t$. Neglecting resistance and inductance, circuit theory gives $$I=-\omega CV_0\sin\omega t=-\omega\frac{\epsilon S}{d}V_0\sin\omega t,$$ where $S$ is plate area and $d$ is plate separation. A surface bounded by the chosen Ampèrian path can cut through the wire, in which case it carries conduction current. Another surface with the same boundary can bow between the capacitor plates and intersect no conductor. Between the plates, however, $$\mathbf{D}=\epsilon\mathbf{E}=\epsilon\frac{V_0}{d}\cos\omega t,$$ so the displacement current is $$I_d=S\frac{\partial D}{\partial t}=-\omega\frac{\epsilon S}{d}V_0\sin\omega t.$$ Thus $I_d=I$, and the same magnetic-field circulation is obtained for either surface. The example establishes displacement current as the continuation, in Maxwell's equation, of time-varying current through a capacitive gap.

### Key planning details

- A single closed Ampèrian path can bound many different surfaces.
- A surface cutting the wire carries conduction current.
- A surface passing between capacitor plates carries no conduction current.
- The capacitor field gives $D=\epsilon(V_0/d)\cos\omega t$.
- The displacement current equals $I_d=S\,\partial D/\partial t$.
- For the ideal capacitor example, displacement current equals the wire's conduction current.
- Including displacement current makes magnetic-field circulation independent of the chosen spanning surface.

### Source coverage

- S1.P300.F9.3 shows a filamentary loop connected to parallel capacitor plates and a closed path that may be spanned through either the wire or the capacitor gap.
- The applied emf is $V_0\cos\omega t$.
- Page 301 gives $I=-\omega CV_0\sin\omega t=-\omega(\epsilon S/d)V_0\sin\omega t$.
- The capacitor displacement is $D=\epsilon(V_0/d)\cos\omega t$.
- The source obtains $I_d=-\omega(\epsilon S/d)V_0\sin\omega t$, equal to the conduction current.
- Drill D9.3 compares displacement-current density in radio, transformer, capacitor, and metallic-conductor settings, including a very small $57.6\ \mathrm{pA/m^2}$ result in the conductor.
