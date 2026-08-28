---
title: "1.142 Faraday Induction, Flux Linkage, and Lenz's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 292", "Page 293"]
related: ["transition-from-static-fields-to-time-varying-electromagnetics", "transformer-emf-and-the-differential-form-of-faradays-law", "motional-emf-and-moving-conductors", "self-inductance-mutual-inductance-and-flux-linkage"]
---

# 1.142 Faraday Induction, Flux Linkage, and Lenz's Law

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 292, Page 293

Faraday's law relates induced electromotive force to the time rate of change of magnetic flux through a closed path:
$$
\mathrm{emf}=-\frac{d\Phi}{dt}
$$
 The path need not be a conducting wire. It may include a capacitor or may be an imaginary closed curve in space. The flux $\Phi$ is computed through a surface bounded by that path. A nonzero flux derivative can result from a time-changing magnetic field through a stationary path, relative motion between a steady field and the path, or both. The minus sign expresses Lenz's law: the induced voltage has the direction that would drive a current whose magnetic flux opposes the change responsible for the emf. For an $N$-turn filamentary winding whose turns can be treated as coincident, the law becomes
$$
\mathrm{emf}=-N\frac{d\Phi}{dt}
$$
 Electromotive force is defined by the closed line integral
$$
\mathrm{emf}=\oint\mathbf{E}\cdot d\mathbf{L}
$$
 Substituting the magnetic-flux surface integral yields the general flux form, with path direction and surface normal linked by the right-hand rule.

## Page-Grounded Details

#### Page 292

was not available at that time, and Faraday's goal was to show that a current could be produced by "magnetism."

He worked on this problem intermittently over a period of 10 years, until he was finally successful in 1831.^2 He wound two separate windings on an iron toroid and placed a galvanometer in one circuit and a battery in the other. Upon closing the battery circuit, he noted a momentary deflection of the galvanometer; a similar deflection in the opposite direction occurred when the battery was disconnected. This, of course, was the first experiment he made involving a changing magnetic field, and he followed it with a demonstration that either a moving magnetic field or a moving coil could also produce a galvanometer deflection.

#### 9.1.1 Faraday's Law in Point and Integral Forms

In terms of fields, we now say that a time-varying magnetic field produces an electromotive force (emf) that may establish a current in a suitable closed circuit. An electromotive force is merely a voltage that arises from conductors moving in a magnetic field or from changing magnetic fields, and we shall define it in this section. Faraday's law is customarily stated as
$$
\mathrm{emf}=-\frac{d

[Truncated for analysis]

#### Page 293

We need to define emf as used in (1) or (2). The emf is obviously a scalar, and (perhaps not so obviously) a dimensional check shows that it is measured in volts. We define the emf as
$$
 emf=\oint\mathbf{E}\cdot d\mathbf{L}\qquad(3)
$$
and note that it is the voltage about a specific closed path. If any part of the path is changed, generally the emf changes. The departure from static results is clearly shown by (3), for an electric field intensity resulting from a static charge distribution must lead to zero potential difference about a closed path. In electrostatics, the line integral leads to a potential difference; with time-varying fields, the result is an emf or a voltage.

Replacing $\Phi$ in (1) with the surface integral of $\mathbf{B}$, we have
$$
 emf=\oint\mathbf{E}\cdot d\mathbf{L}=-\frac{d}{dt}\int_{S}\mathbf{B}\cdot d\mathbf{S}\qquad(4) $$
where the fingers of our right hand indicate the direction of the closed path, and our thumb indicates the direction of $d\mathbf{S}$. A flux density $\mathbf{B}$ in the direction of $d\mathbf{S}$ and increasing with time thus produces an average value of $\mathbf{E}$ which is opposite to the positive direction about t

[Truncated for analysis]

## Core Ideas

- Faraday's law is $\mathrm{emf}=-d\Phi/dt$.
- The law applies to a closed path that need not be entirely conducting.
- Flux change may come from time variation, relative motion, or both.
- Lenz's law determines the opposing sign and direction of the induced response.
- For coincident $N$-turn windings, $\mathrm{emf}=-N\,d\Phi/dt$.
- Electromotive force is the closed-path voltage $\oint\mathbf{E}\cdot d\mathbf{L}$.
- The right-hand rule links positive path direction to the chosen surface normal.

## Source Anchors

- Equation (1) states $\mathrm{emf}=-d\Phi/dt$.
- The source lists three causes of nonzero $d\Phi/dt$: changing flux, relative motion, and their combination.
- The minus sign is identified with Lenz's law and an opposing induced flux.
- Equation (2) gives $\mathrm{emf}=-N\,d\Phi/dt$ for an $N$-turn filamentary conductor.
- Equation (3) defines $\mathrm{emf}=\oint\mathbf{E}\cdot d\mathbf{L}$.
- Equation (4) writes $\oint\mathbf{E}\cdot d\mathbf{L}=-\frac{d}{dt}\int_S\mathbf{B}\cdot d\mathbf{S}$.

## Related Pages

- [[transition-from-static-fields-to-time-varying-electromagnetics|Transition from Static Fields to Time-Varying Electromagnetics]]
- [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
- [[motional-emf-and-moving-conductors|Motional EMF and Moving Conductors]]
- [[self-inductance-mutual-inductance-and-flux-linkage|Self-Inductance, Mutual Inductance, and Flux Linkage]]

## Concept Dependencies

- part-of: [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
- part-of: [[motional-emf-and-moving-conductors|Motional EMF and Moving Conductors]]
- related: [[self-inductance-mutual-inductance-and-flux-linkage|Self-Inductance, Mutual Inductance, and Flux Linkage]]
