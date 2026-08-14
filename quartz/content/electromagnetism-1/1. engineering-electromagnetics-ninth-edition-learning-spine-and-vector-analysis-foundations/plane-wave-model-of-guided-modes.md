---
title: "1.269 Plane-Wave Model of Guided Modes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 480, Figure 13.11", "Page 482, Section 13.3 and Figure 13.13", "Page 483, Section 13.3.1 and Figure 13.14", "Page 484, Equation (36)"]
related: ["transverse-resonance-and-mode-quantization", "parallel-plate-mode-propagation-and-cutoff", "te-mode-fields-from-plane-wave-superposition", "phase-and-group-velocities-in-a-waveguide"]
---

# 1.269 Plane-Wave Model of Guided Modes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 480, Figure 13.11, Page 482, Section 13.3 and Figure 13.13, Page 483, Section 13.3.1 and Figure 13.14, Page 484, Equation (36)

A non-TEM mode in a parallel-plate guide can be interpreted as a pair of plane waves repeatedly reflecting between the conducting plates while making net progress along $z$. The upward and downward wavevectors, $\mathbf{k}_u$ and $\mathbf{k}_d$, have equal magnitude $k=\omega\sqrt{\mu\epsilon}$ but opposite transverse components. A guided mode exists only when all upward-propagating waves are mutually in phase and all downward-propagating waves are likewise in phase. This phase-coincidence requirement restricts the incidence angle to discrete values. Each allowed angle and its corresponding interference field pattern define one mode. Figure 13.13 contrasts a nonmodal angle, for which successive upward-wave phase fronts do not coincide, with an adjusted angle that produces coincident fronts and guided propagation. The wavevector is decomposed into transverse and axial phase constants, $\kappa_m$ and $\beta_m$, satisfying
$$
\beta_m=\sqrt{k^2-\kappa_m^2}
$$
 The mode number $m$ labels the permitted discrete directions rather than changing the magnitude of the constituent plane-wave vectors.

## Page-Grounded Details

#### Page 480

Figure 13.10 Optical fiber waveguide, with the core dielectric ($\rho < \alpha$) of refractive index $n_{1}$. The cladding dielectric ($\alpha < \rho < b$) is of index $n_{2} < n_{1}$.

this as a transmission-line wave, which, as discussed in Section 13.1, is a transverse electromagnetic, or TEM, wave. The wavevector $\mathbf{k}$, shown in Figure 13.1, indicates the direction of wave travel as well as the direction of power flow.

As the frequency is increased, a remarkable change occurs in the way the fields progagate down the line. Although the original field configuration of Figure 13.1 may still be present, another possibility emerges, which is shown in Figure 13.11. Again, a plane wave is guided in the $z$ direction, but by means of a progression of zig-zag reflections at the upper and lower plates. Wavevectors $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$ are associated with the upward-and downward-propagating waves, respectively, and these have identical magnitudes,
$$
|\mathbf{k}_{u}|=|\mathbf{k}_{d}|=k=\omega\sqrt{\mu\epsilon}
$$
For such a wave to propagate, all upward-propagating waves must be in phase (as must be true of all downward-propagating waves). This c

[Truncated for analysis]

#### Page 482

#### 13.3 PLANE WAVE ANALYSIS OF THE PARALLEL-PLATE WAVEGUIDE

We now investigate the conditions under which waveguide modes will occur, using our plane wave model for the mode fields. In Figure 13.13$a$, a zig-zag path is again shown, but this time phase fronts are drawn that are associated with two of the upward-propagating waves. The first wave has reflected twice (at the top and bottom surfaces) to form the second wave (the downward-propagating phase fronts are not shown). Note that the phase fronts of the second wave do not coincide with those of the first wave, and so the two waves are out of phase. In Figure 13.13$b$, the wave angle has been adjusted so that the two waves are now in phase. Having satisfied this condition for the two waves, we will find that $all$ upward-propagating waves will have coincident phase fronts. The same condition will automatically occur for all downward-propagating waves. This is the requirement to establish a guided mode.

#### 13.3.1 Wave Geometry

In Figure 13.14 we show the wavevector, $\mathbf{k}_{u}$ , and its components, along with a series of phase fronts. A drawing of this kind for $\mathbf{k}_{d}$ would be the same, except the

Figu

[Truncated for analysis]

#### Page 483

Figure 13.14 The components of the upward wavevector are $\kappa_{m}$ and $\beta_{m}$, the transverse and axial phase constants. To form the downward wavevector, $\mathbf{k}_{d}$, the direction of $\kappa_{m}$ is reversed.

x component, $\kappa_{m}$, would be reversed. In Section 12.4, we measured the phase shift per unit distance along the x and z directions by the components, $k_{x}$ and $k_{z}$, which varied continuously as the direction of $\mathbf{k}$ changed. In our discussion of waveguides, we introduce a different notation, where $\kappa_{m}$ and $\beta_{m}$ are used for $k_{x}$ and $k_{z}$. The subscript m is an integer indicating the mode number. This provides a subtle hint that $\beta_{m}$ and $\kappa_{m}$ will assume only certain discrete values that correspond to certain allowed directions of $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$, such that our coincident phase front requirement is satisfied.$^{4}$ From the geometry we see that for any value of m,
$$
\beta_{m}=\sqrt{k^{2}-\kappa_{m}^{2}}\quad{(35)}
$$
Use of the symbol $\beta_{m}$ for the z components of $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$ is appropriate because $\beta_{m}$

[Truncated for analysis]

#### Page 484

which we express either in terms of the dielectric constant, $\epsilon_{r}^{\prime}$, or the refractive index, $n$, of the medium.

#### 13.3.2 Transverse Resonance and Cutoff

It is $\kappa_{m}$, the $x$ component of $k_{u}$ and $k_{d}$, that will be useful to us in quantifying our requirement on coincident phase fronts through a condition known as transverse resonance. This condition states that the net phase shift measured during a round trip over the full transverse dimension of the guide must be an integer multiple of $2\pi$ radians. This is another way of stating that all upward-(or downward-) propagating plane waves must have coincident phases. The various segments of this round trip are illustrated in Figure 13.15. We assume for this exercise that the waves are frozen in time and that an observer moves vertically over the round trip, measuring phase shift along the way. In the first segment (Figure 13.15a), the observer starts at a position just above the lower conductor and moves vertically to the top conductor through distance $d$. The measured phase shift over this distance is $\kappa_{m}d$ rad. On reaching the top surface, the observer will note a poss

[Truncated for analysis]

## Core Ideas

- The constituent plane waves have magnitude $k=\omega\sqrt{\mu\epsilon}$.
- Upward and downward waves have opposite transverse wavevector components.
- A guided mode requires coincident phase fronts among repeated waves traveling in the same transverse direction.
- Only discrete incidence angles satisfy the phase-coincidence requirement.
- The transverse and axial components obey $k^2=\kappa_m^2+\beta_m^2$.
- $\beta_m$ measures phase shift per unit distance along the guide.
- Changing mode number changes wavevector direction, not its magnitude at fixed frequency.

## Source Anchors

- Figure 13.11 depicts zig-zag propagation by oblique reflection from conducting walls.
- The source gives $|\mathbf{k}_u|=|\mathbf{k}_d|=k=\omega\sqrt{\mu\epsilon}$.
- Figure 13.13(a) shows noncoincident phase fronts, while Figure 13.13(b) shows the angle adjusted to establish a guided mode.
- Figure 13.14 resolves the upward wavevector into $\kappa_m$ and $\beta_m$.
- Equation (35) gives $\beta_m=\sqrt{k^2-\kappa_m^2}$.
- For a lossless nonmagnetic dielectric, Equation (36) gives $k=\omega n/c$.

## Related Pages

- [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
- [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
- [[te-mode-fields-from-plane-wave-superposition|TE Mode Fields from Plane-Wave Superposition]]
- [[phase-and-group-velocities-in-a-waveguide|Phase and Group Velocities in a Waveguide]]

## Concept Dependencies

- enables: [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
- enables: [[te-mode-fields-from-plane-wave-superposition|TE Mode Fields from Plane-Wave Superposition]]
- enables: [[phase-and-group-velocities-in-a-waveguide|Phase and Group Velocities in a Waveguide]]
