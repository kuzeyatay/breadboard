---
title: "1.146 Capacitor Illustration of Displacement Current"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 300", "Page 301", "Page 302"]
related: ["displacement-current-from-charge-continuity", "maxwell-equations-in-integral-form-and-field-boundaries", "maxwell-equations-and-supporting-constitutive-relations"]
---

# 1.146 Capacitor Illustration of Displacement Current

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 300, Page 301, Page 302

The parallel-plate capacitor example explains why displacement current is necessary for a surface-independent application of Ampère's circuital law. A filamentary loop containing a capacitor is driven by an induced emf $V_0\cos\omega t$. Neglecting resistance and inductance, circuit theory gives
$$
I=-\omega CV_0\sin\omega t=-\omega\frac{\epsilon S}{d}V_0\sin\omega t
$$
 where $S$ is plate area and $d$ is plate separation. A surface bounded by the chosen Ampèrian path can cut through the wire, in which case it carries conduction current. Another surface with the same boundary can bow between the capacitor plates and intersect no conductor. Between the plates, however,
$$
\mathbf{D}=\epsilon\mathbf{E}=\epsilon\frac{V_0}{d}\cos\omega t
$$
 so the displacement current is
$$
I_d=S\frac{\partial D}{\partial t}=-\omega\frac{\epsilon S}{d}V_0\sin\omega t
$$
 Thus $I_d=I$, and the same magnetic-field circulation is obtained for either surface. The example establishes displacement current as the continuation, in Maxwell's equation, of time-varying current through a capacitive gap.

## Page-Grounded Details

#### Page 300

Figure 9.3 A filamentary conductor forms a loop connecting the two plates of a parallel-plate capacitor. A time-varying magnetic field inside the closed path produces an emf of $V_{0}\cos\omega t$ around the closed path. The conduction current / is equal to the displacement current between the capacitor plates.

however, for it fails when we investigate forces on particles. The force on a charge is related to E and to B, and some good arguments may be presented showing an analogy between E and B and between D and H. We omit them, however, and merely say that the concept of displacement current was probably suggested to Maxwell by the symmetry first mentioned in this paragraph.^6

The total displacement current crossing any given surface is expressed by the surface integral,
$$
I_{d}=\int_{S} \mathbf{J}_{d} \cdot d\mathbf{S}=\int_{S} \frac{\partial\mathbf{D}}{\partial t} \cdot d\mathbf{S}
$$
and we may obtain the time-varying version of Ampère's circuital law by integrating (17) over the surface S,S,
$$
\int_{S} (\nabla \times \mathbf{H}) \cdot d\mathbf{S}=\int_{S} \mathbf{J} \cdot d\mathbf{S}+\int_{S} \frac{\partial\mathbf{D}}{\partial t} \cdot d\mathbf{S}
$$
and applying Sto

[Truncated for analysis]

#### Page 301

the loop, a magnetic field varying sinusoidally with time is applied to produce an emf about the closed path (the filament plus the dashed portion between the capacitor plates), which we shall take as
$$
emf=V_{0} \cos \omega t
$$
Using elementary circuit theory and assuming that the loop has negligible resistance and inductance, we may obtain the current in the loop as
$$
\begin{align*}I &= -\omega CV_{0} \sin \omega t \\&= -\omega \frac{eS}{d}V_{0} \sin \omega t\end{align*}
$$
where the quantities $\epsilon$, $S$, and $d$ pertain to the capacitor. We now apply Ampère's circuit law about the smaller closed circular path $k$ and neglect displacement current for the moment:
$$
\oint_{k} \mathbf{H} \cdot d\mathbf{L} = I_{k}
$$
The path and the value of $\mathbf{H}$ along the path are both definite quantities (although difficult to determine), and $\oint_{k} \mathbf{H} \cdot d\mathbf{L}$ is a definite quantity. The current $I_{k}$ is that current through every surface whose perimeter is the path $k$. If we choose a simple surface punctured by the filament, such as the plane circular surface defined by the circular path $k$, the current is evidently the conducti

[Truncated for analysis]

#### Page 302

The last part of the following drill problem indicates the reason why this additional current was never discovered experimentally.

D9.3. Find the amplitude of the displacement current density: (a) adjacent to an automobile antenna where the magnetic field intensity of an FM signal is $H_{x}=0.15\cos[3.12(3\times 10^{8}t-y)]$ A/m; (b) in the airspace at a point within a large power distribution transformer where $\mathbf{B}=0.8\cos[1.257\times 10^{-6}(3\times 10^{8}t-x)]\mathbf{a}_{y}$ T; (c) within a large, oil-filled power capacitor where $\epsilon_{r}=5$ and $\mathbf{E}=0.9\cos[1.257\times 10^{-6}(3\times 10^{8}t-z\sqrt{5})]\mathbf{a}_{x}$ MV/m; (d) in a metallic conductor at 60 Hz, if $\epsilon=\epsilon_{0}$, $\mu=\mu_{0}$, $\sigma=5.8\times 10^{7}$ S/m, and $\mathbf{J}=\sin(377t-117.1z)\mathbf{a}_{x}$ MA/m^2.

Ans. (a) 0.468 A/m^2; (b) 0.800 A/m^2; (c) 0.0150 A/m^2; (d) 57.6 pA/m^2

#### 9.3 MAXWELL'S EQUATIONS IN POINT FORM

We have already obtained two of Maxwell's equations for time-varying fields,
$$
\nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t}\quad{(20)}
$$
and
$$ \nabla\times\mathbf{H}=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}\q

[Truncated for analysis]

## Core Ideas

- A single closed Ampèrian path can bound many different surfaces.
- A surface cutting the wire carries conduction current.
- A surface passing between capacitor plates carries no conduction current.
- The capacitor field gives $D=\epsilon(V_0/d)\cos\omega t$.
- The displacement current equals $I_d=S\,\partial D/\partial t$.
- For the ideal capacitor example, displacement current equals the wire's conduction current.
- Including displacement current makes magnetic-field circulation independent of the chosen spanning surface.

## Source Anchors

- S1.P300.F9.3 shows a filamentary loop connected to parallel capacitor plates and a closed path that may be spanned through either the wire or the capacitor gap.
- The applied emf is $V_0\cos\omega t$.
- Page 301 gives $I=-\omega CV_0\sin\omega t=-\omega(\epsilon S/d)V_0\sin\omega t$.
- The capacitor displacement is $D=\epsilon(V_0/d)\cos\omega t$.
- The source obtains $I_d=-\omega(\epsilon S/d)V_0\sin\omega t$, equal to the conduction current.
- Drill D9.3 compares displacement-current density in radio, transformer, capacitor, and metallic-conductor settings, including a very small $57.6\ \mathrm{pA/m^2}$ result in the conductor.

## Related Pages

- [[displacement-current-from-charge-continuity|Displacement Current from Charge Continuity]]
- [[maxwell-equations-in-integral-form-and-field-boundaries|Maxwell Equations in Integral Form and Field Boundaries]]
- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]

## Concept Dependencies

- example-of: [[displacement-current-from-charge-continuity|Displacement Current from Charge Continuity]]
