---
title: "1.270 TE and TM Polarization in Parallel-Plate Guides"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 481, Figure 13.12", "Page 484, discussion of reflection phase", "Page 486, Figure 13.16"]
related: ["tem-transmission-line-waves-and-waveguide-modes", "transverse-resonance-and-mode-quantization", "te-mode-fields-from-plane-wave-superposition", "parallel-plate-te-magnetic-fields"]
---

# 1.270 TE and TM Polarization in Parallel-Plate Guides

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 481, Figure 13.12, Page 484, discussion of reflection phase, Page 486, Figure 13.16

The two basic non-TEM mode families in a parallel-plate guide follow from the familiar s and p polarizations of obliquely incident plane waves. A transverse electric, or TE, mode arises from s polarization: the electric field is perpendicular to the plane of incidence and lies entirely in the guide's transverse plane. In the geometry shown, the TE electric field points along $y$, while its magnetic field has $x$ and $z$ components. A transverse magnetic, or TM, mode arises from p polarization: the magnetic field lies entirely along $y$ and is transverse, while the electric field has both $x$ and $z$ components. Except at the special angle $\theta=90^\circ$, neither configuration is purely TEM because one field contains a longitudinal component. Other polarization states can be represented as superpositions of TE and TM modes. Reflection from a perfect conductor introduces a $\pi$ phase reversal for the TE electric field but no overall phase shift for the TM wave under the geometric comparison used in the text.

## Page-Grounded Details

#### Page 481

Figure 13.12 Plane wave representation of TE and TM modes in a parallel-plate guide.

If above cutoff, the mode propagates. The TEM mode, however, has no cutoff; it will be supported at any frequency. At a given frequency, the guide may support several modes, the quantity of which depends on the plate separation and on the dielectric constant of the interior medium, as will be shown. The number of modes increases as the frequency is raised.

So to answer our initial question on the distinction between transmission lines and waveguides, we can state the following: Transmission lines consist of two or more conductors and as a rule will support TEM waves (or something which could approximate such a wave). A waveguide may consist of one or more conductors, or no conductors at all, and will support waveguide modes of forms similar to those just described. Waveguides may or may not support TEM waves, depending on the design.

In the parallel-plate guide, two types of waveguide modes can be supported. These are shown in Figure 13.12 as arising from the s and p orientations of the plane wave polarizations. In a manner consistent with our previous discussions on oblique reflection (Section

[Truncated for analysis]

#### Page 484

which we express either in terms of the dielectric constant, $\epsilon_{r}^{\prime}$, or the refractive index, $n$, of the medium.

#### 13.3.2 Transverse Resonance and Cutoff

It is $\kappa_{m}$, the $x$ component of $k_{u}$ and $k_{d}$, that will be useful to us in quantifying our requirement on coincident phase fronts through a condition known as transverse resonance. This condition states that the net phase shift measured during a round trip over the full transverse dimension of the guide must be an integer multiple of $2\pi$ radians. This is another way of stating that all upward-(or downward-) propagating plane waves must have coincident phases. The various segments of this round trip are illustrated in Figure 13.15. We assume for this exercise that the waves are frozen in time and that an observer moves vertically over the round trip, measuring phase shift along the way. In the first segment (Figure 13.15a), the observer starts at a position just above the lower conductor and moves vertically to the top conductor through distance $d$. The measured phase shift over this distance is $\kappa_{m}d$ rad. On reaching the top surface, the observer will note a poss

[Truncated for analysis]

#### Page 486

Figure 13.16 The phase shift of a wave on reflection from a perfectly conducting surface depends on whether the incident wave is TE (s-polarized) or TM (p-polarized). In both drawings, electric fields are shown as they would appear immediately adjacent to the conducting boundary. In (a) the field of a TE wave reverses direction upon reflection to establish a zero net field at the boundary. This constitutes a $\pi$ phase shift, as is evident by considering a fictitious transmitted wave (dashed line) formed by a simple rotation of the reflected wave into alignment with the incident wave. In (b) an incident TM wave experiences a reversal of the $z$ component of its electric field. The resultant field of the reflected wave, however, has not been phase-shifted; rotating the reflected wave into alignment with the incident wave (dashed line) shows this.

We define the radian _cutoff frequency_ for mode $m$ as
$$
\omega_{cm}=\frac{m\pi c}{nd}
$$
(41)

so that (40) becomes
$$
\beta_{m}=\frac{n\omega}{c}\sqrt{1-(\frac{\omega_{cm}}{\omega})^{2}}
$$
(42)

The significance of the cutoff frequency is readily seen from (42): If the operating frequency $\omega$ is greater than the cuto

[Truncated for analysis]

## Core Ideas

- TE modes correspond to s-polarized constituent plane waves.
- For the illustrated TE mode, $E_y$ is transverse while $H_x$ and $H_z$ are present.
- TM modes correspond to p-polarized constituent plane waves.
- For the illustrated TM mode, $H_y$ is transverse while $E_x$ and $E_z$ are present.
- Pure TEM propagation is impossible for oblique angles other than $90^\circ$.
- General polarizations can be decomposed into TE and TM components.
- Perfect-conductor reflection gives the TE electric field a $\pi$ phase shift and the TM wave no net phase shift in the stated convention.

## Source Anchors

- Figure 13.12 presents plane-wave representations of TE and TM modes.
- Page 481 identifies TE with s polarization and TM with p polarization.
- Figure 13.16(a) shows TE electric-field reversal to enforce zero tangential electric field at the conductor.
- Figure 13.16(b) shows reversal of the TM wave's $z$ electric-field component without an overall phase shift after geometric alignment.

## Related Pages

- [[tem-transmission-line-waves-and-waveguide-modes|TEM Transmission-Line Waves and Waveguide Modes]]
- [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
- [[te-mode-fields-from-plane-wave-superposition|TE Mode Fields from Plane-Wave Superposition]]
- [[parallel-plate-te-magnetic-fields|Parallel-Plate TE Magnetic Fields]]

## Concept Dependencies

- applies-to: [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
- related: [[parallel-plate-te-magnetic-fields|Parallel-Plate TE Magnetic Fields]]
