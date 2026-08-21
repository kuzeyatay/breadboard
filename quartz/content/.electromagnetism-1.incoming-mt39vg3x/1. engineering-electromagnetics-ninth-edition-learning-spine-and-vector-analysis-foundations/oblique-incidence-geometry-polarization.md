---
title: "1.260 Oblique-Incidence Geometry and Polarization"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 443", "Page 444", "Page 445", "Section 12.5: Plane Wave Reflection at Oblique Incidence Angles"]
related: ["wavevector-representation-general-plane-waves", "phase-matching-reflection-law-snells-law", "polarization-dependent-fresnel-coefficients", "brewster-angle-total-transmission"]
---

# 1.260 Oblique-Incidence Geometry and Polarization

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 443, Page 444, Page 445, Section 12.5: Plane Wave Reflection at Oblique Incidence Angles

Oblique incidence occurs when a plane wave reaches an interface at a nonzero angle measured from the surface normal. The incident, reflected, and transmitted waves are represented by separate wavevectors $\mathbf{k}_1^+$, $\mathbf{k}_1^-$, and $\mathbf{k}_2$. The plane of incidence is spanned by the incident wavevector and the surface normal. Two independent polarization cases are sufficient because any other linear field orientation can be decomposed into them. For p-polarization, the electric field lies in the plane of incidence, while the magnetic field is transverse to that plane. This case is also called transverse magnetic or TM polarization. For s-polarization, the electric field is perpendicular to the incidence plane and parallel to the interface, giving the alternate name transverse electric or TE polarization. Reflection and transmission angles do not depend on which of these polarizations is used, but the amplitude coefficients do. Figure 12.7 is the source-central geometry because it fixes the directions, angle conventions, interface normal, and field orientations needed for the subsequent boundary-condition derivation.

## Page-Grounded Details

#### Page 443

points between the phase fronts and the x axis. Again, from the geometry, we see that this velocity must be faster than the velocity along k and will, of course, exceed the speed of light in the medium. This does not constitute a violation of special relativity, however, since the energy in the wave flows in the direction of k and not along x or z. The wave frequency is f= w/2π and is invariant with direction. Note, for example, that in the directions we have considered,
$$
f=\frac{v_{p}}{\lambda}=\frac{v_{px}}{\lambda_{x}}=\frac{\omega}{2\pi}
$$
#### EXAMPLE 12.6

Consider a 50-MHz uniform plane wave having electric field amplitude 10 V/m. The medium is lossless, having $\mathrm{e}_{r}=\mathrm{e}_{r}^{\prime}=9.0$ and $\mathrm{\mu}_{r}=1.0$. The wave propagates in the x, y plane at a $30^{\circ}$ angle to the x axis and is linearly polarized along z. Write down the phasor expression for the electric field.

Solution. The propagation constant magnitude is
$$
k=\omega\sqrt{\mu\overline{\epsilon}}=\frac{\omega\sqrt{\overline{\epsilon}_{r}}}{c}=\frac{2\pi\times 50\times 10^{6}(3)}{3\times 10^{8}}=3.2\mathrm{m}^{-1}
$$
The vector k is now
$$ \mathbf{k}=3.2(\cos 30\mathbf{a}_

[Truncated for analysis]

#### Page 444

Figure 12.7 Geometries for plane wave incidence at angle $\theta_{1}$ onto an interface between dielectrics having intrinsic impedances $\eta_{1}$ and $\eta_{2}$. The two polarization cases are shown: (a) p-polarization (or TM), with **E** in the plane of incidence; (b) s-polarization (or TE), with **E** perpendicular to the plane of incidence.

The situation is illustrated in Figure 12.7, in which the incident wave direction and position-dependent phase are characterized by wavevector $\mathbf{k}_{1}^{+}$. The angle of incidence is the angle between $\mathbf{k}_{1}^{+}$ and a line that is normal to the surface (the $x$ axis in this case). The incidence angle is shown as $\theta_{1}$. The reflected wave, characterized by wavevector $\mathbf{k}_{1}^{-}$, will propagate away from the interface at angle $\theta_{1}^{\prime}$. Finally, the transmitted wave, characterized by $\mathbf{k}_{2}$, will propagate into the second region at angle $\theta_{2}$ as shown. One would suspect (from previous experience) that the incident and reflected angles are equal ($\theta_{1}=\theta_{1}^{\prime}$), which is correct. We need to show this, however, to be complete.

The two m

[Truncated for analysis]

#### Page 445

Because E is used to define polarization, the configuration is called perpendicular polarization, or is said to be s-polarized.^3 E is also parallel to the interface, and so the case is also called transverse electric, or TE polarization. We will find that the reflec-tion and transmission coefficients will differ for the two polarization types, but that reflection and transmission angles will not depend on polarization. We only need to consider s- and p-polarizations because any other field direction can be constructed as some combination of s and p waves.

Our desired knowledge of reflection and transmission coefficients, as well as how the angles relate, can be found through the field boundary conditions at the interface. Specifically, we require that the transverse components of E and H be continuous across the interface. These were the conditions we used to find $\Gamma$ and $\tau$ for normal incidence ($\theta_{1}=0$), which is in fact a special case of our current problem.We will consider the case of p-polarization (Figure 12.7a) first. To begin, we write down the incident, reflected, and transmitted fields in phasor form, using the notation developed in Section 12.4:

[Truncated for analysis]

## Core Ideas

- Incidence and reflection angles are measured from the surface normal.
- The plane of incidence contains the incident wavevector and the interface normal.
- For p or TM polarization, $\mathbf{E}$ lies in the plane of incidence.
- For s or TE polarization, $\mathbf{E}$ is perpendicular to the plane of incidence.
- Any polarization can be decomposed into s and p components.
- Angles are polarization independent, while reflection and transmission coefficients are polarization dependent.
- The two media are treated as lossless, nonmagnetic dielectrics.

## Source Anchors

- Figure S1.P444.F1, corresponding to Figure 12.7, shows incident, reflected, and transmitted wavevectors for p and s polarization.
- Page 444 defines the incidence angle as the angle between $\mathbf{k}_1^+$ and the surface normal.
- Page 444 defines the plane of incidence using the incident wavevector and surface normal.
- Page 444 identifies p-polarization with parallel polarization and TM polarization.
- Page 445 identifies s-polarization with perpendicular polarization and TE polarization.
- The source states that any other field direction can be constructed from s and p waves.

## Related Pages

- [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- [[polarization-dependent-fresnel-coefficients|Polarization-Dependent Fresnel Coefficients]]
- [[brewster-angle-total-transmission|Brewster-Angle Total Transmission]]

## Concept Dependencies

- depends-on: [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
