---
title: "1.272 Parallel-Plate Mode Propagation and Cutoff"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 484, Equation (40)", "Page 486, Equations (41) through (43)", "Page 487, Equation (44) and Example 13.1", "Page 490, Problems D13.6 and D13.7"]
related: ["transverse-resonance-and-mode-quantization", "counting-propagating-parallel-plate-modes", "below-cutoff-evanescent-fields", "phase-and-group-velocities-in-a-waveguide"]
---

# 1.272 Parallel-Plate Mode Propagation and Cutoff

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 484, Equation (40), Page 486, Equations (41) through (43), Page 487, Equation (44) and Example 13.1, Page 490, Problems D13.6 and D13.7

Substituting the quantized transverse constant into the wavevector relation produces the axial phase constant for mode $m$:
$$
\beta_m=\sqrt{k^2-\left(\frac{m\pi}{d}\right)^2}
$$
 The radian cutoff frequency is defined by the point at which $\beta_m=0$:
$$
\omega_{cm}=\frac{m\pi c}{nd}
$$
 Consequently,
$$
\beta_m=\frac{n\omega}{c}\sqrt{1-\left(\frac{\omega_{cm}}{\omega}\right)^2}
$$
 If $\omega>\omega_{cm}$, then $\beta_m$ is real and the mode propagates. If $\omega<\omega_{cm}$, it is imaginary and the field is evanescent. The associated free-space cutoff wavelength is
$$
\lambda_{cm}=\frac{2nd}{m}
$$
 and propagation equivalently requires $\lambda<\lambda_{cm}$. For an air-filled guide, the first higher-order mode begins at $\lambda_{c1}=2d$. Since cutoff rises linearly with $m$, a frequency interval can be selected to permit TEM alone or TEM plus only specified higher-order modes.

## Page-Grounded Details

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

#### Page 487

Note, for example, that in an air-filled guide (n = 1) the wavelength at which the lowest-order mode first starts to propagate is $\lambda_{c1}=2d$, or the plate separation is one-half wavelength. Mode m will propagate whenever $\omega>\omega_{cm}$, or equivalently whenever $\lambda<\lambda_{cm}$. Use of the cutoff wavelength enables us to construct a second useful form of Eq. (42):
$$
\beta_{m}=\frac{2\pi n}{\lambda}\sqrt{1-(\frac{\lambda}{\lambda_{cm}})^{2}}\quad{(44)}
$$
#### Example 13.1

A parallel-plate waveguide has plate separation d = 1 cm and is filled with Teflon having dielectric constant $\epsilon_{r}^{\prime}=2.1$. Determine the maximum operating frequency such that only the TEM mode will propagate. Also find the range of frequencies over which the TE_1 and TM_1 (m = 1) modes, and no higher-order modes, will propagate.

Solution. Using (41), the cutoff frequency for the first waveguide mode (m = 1) will be
$$
f_{c1}=\frac{\omega_{c1}}{2\pi}=\frac{2.99\times 10^{10}}{2\sqrt{2.1}}=1.03\times 10^{10}\,\text{Hz}=10.3\,\text{GHz}
$$
To propagate only TEM waves, we must have f < 10.3 GHz. To allow TE_1 and TM_1 (along with TEM) only, the frequency range must be

[Truncated for analysis]

#### Page 490

Solution. The group delay difference is expressed as
$$
\Delta t=\left(\frac{1}{v_{g2}}-\frac{1}{v_{g1}}\right)\text{(s/cm)}
$$
From (57), along with the results of Example 13.1, we have
$$
v_{g1}=\frac{c}{\sqrt{2.1}}\sqrt{1-\left(\frac{10.3}{25}\right)^{2}}=0.63c
$$
$$
v_{g2}=\frac{c}{\sqrt{2.1}}\sqrt{1-\left(\frac{20.6}{25}\right)^{2}}=0.39c
$$
Then
$$
\Delta t=\frac{1}{c}\left[\frac{1}{.39}-\frac{1}{.63}\right]=3.3\times 10^{-11}\,\text{s/cm}=33\,\text{ps/cm}
$$
This computation gives a rough measure of the modal dispersion in the guide, apply-ing to the case of having only two modes propagating. A pulse, for example, whose center frequency is 25 GHz would have its energy divided between the two modes.The pulse would broaden by approximately 33 ps/cm of propagation distance as the energy in the modes separates. If, however, we include the TEM mode (as we really must), then the broadening will be even greater. The group velocity for TEM will be$c/\sqrt{2.1}$. The group delay difference of interest will then be between the TEM mode and the $m=2$ mode (TE or TM). We would therefore have
$$
\Delta t_{\text{net}}=\frac{1}{c}\left[\frac{1}{.39}-1\right]=52\,\text{ps/cm}
$$
[Truncated for analysis]

## Core Ideas

- The mode phase constant is $\beta_m=\sqrt{k^2-\kappa_m^2}$.
- The cutoff frequency is $\omega_{cm}=m\pi c/(nd)$.
- Propagation requires $\omega>\omega_{cm}$.
- Below cutoff, $\beta_m$ is imaginary and the mode is evanescent.
- The cutoff wavelength is $\lambda_{cm}=2nd/m$.
- Propagation in wavelength form requires $\lambda<\lambda_{cm}$.
- Higher mode order produces a higher cutoff frequency.
- The TEM mode remains available below the first higher-order cutoff.

## Source Anchors

- Equation (40) expresses $\beta_m$ after inserting $\kappa_m=m\pi/d$.
- Equations (41) and (42) define $\omega_{cm}$ and express $\beta_m$ in normalized cutoff form.
- Equations (43) and (44) give the cutoff wavelength and wavelength-domain phase constant.
- Example 13.1 finds $f_{c1}=10.3\ \text{GHz}$ for $d=1\ \text{cm}$ and $\epsilon_r'=2.1$.
- Example 13.1 gives TEM-only operation below $10.3\ \text{GHz}$ and TEM plus $m=1$ TE and TM modes from $10.3$ to $20.6\ \text{GHz}$.
- Problem D13.6 gives a TEM-only maximum frequency of $20.7\ \text{GHz}$ for $d=5\ \text{mm}$ and $n=1.45$.
- Problem D13.7 gives $\lambda_{c2}=1\ \text{cm}$ for an air-filled guide with $d=1\ \text{cm}$.

## Related Pages

- [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
- [[counting-propagating-parallel-plate-modes|Counting Propagating Parallel-Plate Modes]]
- [[below-cutoff-evanescent-fields|Below-Cutoff Evanescent Fields]]
- [[phase-and-group-velocities-in-a-waveguide|Phase and Group Velocities in a Waveguide]]

## Concept Dependencies

- enables: [[counting-propagating-parallel-plate-modes|Counting Propagating Parallel-Plate Modes]]
- causes: [[below-cutoff-evanescent-fields|Below-Cutoff Evanescent Fields]]
- enables: [[phase-and-group-velocities-in-a-waveguide|Phase and Group Velocities in a Waveguide]]
