---
title: "1.147 Maxwell Equations and Supporting Constitutive Relations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 302", "Page 303", "Page 304"]
related: ["transformer-emf-and-the-differential-form-of-faradays-law", "displacement-current-from-charge-continuity", "maxwell-equations-in-integral-form-and-field-boundaries", "magnetic-force-and-torque-on-charges-and-currents", "magnetization-magnetic-materials-and-bound-currents", "permanent-magnetization-and-equivalent-magnetic-sources"]
---

# 1.147 Maxwell Equations and Supporting Constitutive Relations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 302, Page 303, Page 304

The source assembles the four point-form Maxwell equations for time-varying fields. Faraday's law is
$$
\nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t}
$$
 and the Ampère-Maxwell law is
$$
\nabla\times\mathbf{H}=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}
$$
 Gauss's electric law remains
$$
\nabla\cdot\mathbf{D}=\rho_v
$$
 while Gauss's magnetic law is
$$
\nabla\cdot\mathbf{B}=0
$$
 Together they relate electric and magnetic fields to charge and current sources. The source stresses that changing magnetic fields can make electric flux lines circulate in closed loops, so not all electric flux lines need begin and end on charge. Magnetic flux, by contrast, always forms closed loops because no magnetic charge has been observed. Maxwell's equations require supporting relations to close a material problem, including $\mathbf{D}=\epsilon\mathbf{E}$, $\mathbf{B}=\mu\mathbf{H}$, $\mathbf{J}=\sigma\mathbf{E}$, and $\mathbf{J}=\rho_v\mathbf{v}$. More general material descriptions use polarization $\mathbf{P}$ and magnetization $\mathbf{M}$. The force connection is supplied by the Lorentz force density $\mathbf{f}=\rho_v(\mathbf{E}+\mathbf{v}\times\mathbf{B})$.

## Page-Grounded Details

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
$$
\nabla\times\mathbf{H}=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}\q

[Truncated for analysis]

#### Page 303

and to their sources, charge, and current density. The auxiliary equations relating D and E
$$
 D=eE\quad{(24)}
$$
relating B and H
$$
 B=\mu H\quad{(25)}
$$
defining conduction current density
$$
 J=\sigma E\quad{(26)}
$$
and defining convection current density in terms of the volume charge density $\rho v$
$$
 J=\rho_{v}v\quad{(27)}
$$
are also required to define and relate the quantities appearing in Maxwell's equations.

The potentials V and A have not been included because they are not strictly necessary, although they are extremely useful. They will be discussed at the end of this chapter.

If we do not have "nice" materials to work with, then we should replace (24) and (25) with the relationships involving the polarization and magnetization fields
$$
 D=\epsilon_{0}E+P\quad{(28)}
$$
$$
 B=\mu_{0}(H+M)\quad{(29)}
$$
For linear materials we may relate P to E
$$
 P=\chi_{e}\epsilon_{0}E\quad{(30)}
$$
and M to H
$$
 M=\chi_{m}H\quad{(31)}
$$
Finally, because of its fundamental importance we should include the Lorentz force equation, written in point form as the force per unit volume
$$
 f=\rho_{v}(E+v\times B)\quad{(32)}
$$
The chapters that follow are devoted to

[Truncated for analysis]

#### Page 304

D9.4. Let $\mu=10^{-5}$ H/m, $\epsilon=4\times 10^{-9}$ F/m, $\sigma=0$, and $\rho_{v}=0$. Find k (including units) so that each of the following pairs of fields satisfies Maxwell's equations: (a) $\mathbf{D}=6\mathbf{a}_{x}-2y\mathbf{a}_{y}+2z\mathbf{a}_{z}$ nC/m^2, $\mathbf{H}=k x\mathbf{a}_{x}+10y\mathbf{a}_{y}-25z\mathbf{a}_{z}$ A/m; (b) $\mathbf{E}=(20y-kt)\mathbf{a}_{x}$ V/m, $\mathbf{H}=(y+2\times 10^{6}t)\mathbf{a}_{z}$ A/m.

Answer. (a) 15 A/m^2; (b) $-2.5\times 10^{8}$ V/(m*s)

#### 9.4 MAXWELL'S EQUATIONS IN INTEGRAL FORM

The integral forms of Maxwell's equations are usually easier to recognize in terms of the experimental laws from which they have been obtained by a generalization process. Experiments must treat physical macroscopic quantities, and their results therefore are expressed in terms of integral relationships. A differential equation always represents a theory. We now collect the integral forms of Maxwell's equations from Section 9.3.

Integrating (20) over a surface and applying Stokes' theorem, we obtain Fara-day's law
$$
 \oint\mathbf{E}\cdot d\mathbf{L}=-\int_{S}\frac{\partial\mathbf{B}}{\partial t}\cdot d\mathbf{S}\qquad(33) $$
and t

[Truncated for analysis]

## Core Ideas

- Faraday's point equation couples changing $\mathbf{B}$ to curl of $\mathbf{E}$.
- The Ampère-Maxwell equation couples current and changing $\mathbf{D}$ to curl of $\mathbf{H}$.
- Electric charge density is the divergence source of $\mathbf{D}$.
- Magnetic flux density has zero divergence.
- Constitutive relations are needed to connect intensity and flux-density fields.
- Polarization and magnetization provide more general material descriptions.
- The Lorentz force density links fields to mechanical force on charge.

## Source Anchors

- Equations (20) through (23) list the four point-form Maxwell equations.
- The source states that changing magnetic fields allow electric flux lines to form closed loops.
- Equation (23), $\nabla\cdot\mathbf{B}=0$, is interpreted as the absence of known magnetic charges.
- Equations (24) through (27) give $\mathbf{D}=\epsilon\mathbf{E}$, $\mathbf{B}=\mu\mathbf{H}$, conduction current, and convection current.
- Equations (28) and (29) give $\mathbf{D}=\epsilon_0\mathbf{E}+\mathbf{P}$ and $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$.
- Equations (30) and (31) relate polarization and magnetization to field intensity in linear materials.
- Equation (32) gives $\mathbf{f}=\rho_v(\mathbf{E}+\mathbf{v}\times\mathbf{B})$.

## Related Pages

- [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
- [[displacement-current-from-charge-continuity|Displacement Current from Charge Continuity]]
- [[maxwell-equations-in-integral-form-and-field-boundaries|Maxwell Equations in Integral Form and Field Boundaries]]
- [[magnetic-force-and-torque-on-charges-and-currents|Magnetic Force and Torque on Charges and Currents]]
- [[magnetization-magnetic-materials-and-bound-currents|Magnetization, Magnetic Materials, and Bound Currents]]
- [[permanent-magnetization-and-equivalent-magnetic-sources|Permanent Magnetization and Equivalent Magnetic Sources]]

## Concept Dependencies

- related: [[maxwell-equations-in-integral-form-and-field-boundaries|Maxwell Equations in Integral Form and Field Boundaries]]
- enables: [[permanent-magnetization-and-equivalent-magnetic-sources|Permanent Magnetization and Equivalent Magnetic Sources]]
