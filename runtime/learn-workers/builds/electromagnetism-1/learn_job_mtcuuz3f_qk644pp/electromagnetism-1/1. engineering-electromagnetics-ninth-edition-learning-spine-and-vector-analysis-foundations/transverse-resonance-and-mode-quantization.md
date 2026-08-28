---
title: "1.271 Transverse Resonance and Mode Quantization"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 484, Section 13.3.2", "Page 485, Figure 13.15", "Page 486, Figure 13.16", "Page 490, Problem D13.5"]
related: ["plane-wave-model-of-guided-modes", "parallel-plate-mode-propagation-and-cutoff", "parallel-plate-wave-equation-eigenmodes"]
---

# 1.271 Transverse Resonance and Mode Quantization

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 484, Section 13.3.2, Page 485, Figure 13.15, Page 486, Figure 13.16, Page 490, Problem D13.5

Transverse resonance converts the qualitative phase-coincidence requirement into a quantitative mode condition. During one round trip across a plate spacing $d$, the wave accumulates transverse propagation phase $\kappa_m d$ in each direction and reflection phase $\phi$ at each conductor. The required total phase is an integer multiple of $2\pi$:
$$
\kappa_m d+\phi+\kappa_m d+\phi=2m\pi
$$
 For TE reflection, $\phi=\pi$, while for TM reflection, $\phi=0$. Over two reflections these contribute $2\pi$ or zero, so they do not alter the resulting quantization condition. Both mode families therefore satisfy
$$
\kappa_m=\frac{m\pi}{d}
$$
 Since $\kappa_m=k\cos\theta_m$ and $k=\omega n/c$, the permitted wave angles are
$$
\theta_m=\cos^{-1}\left(\frac{m\pi}{kd}\right)=\cos^{-1}\left(\frac{m\pi c}{\omega nd}\right)=\cos^{-1}\left(\frac{m\lambda}{2nd}\right)
$$
 This derivation explains why only discrete transverse field patterns and ray angles can persist in the guide.

## Page-Grounded Details

#### Page 484

which we express either in terms of the dielectric constant, $\epsilon_{r}^{\prime}$, or the refractive index, $n$, of the medium.

#### 13.3.2 Transverse Resonance and Cutoff

It is $\kappa_{m}$, the $x$ component of $k_{u}$ and $k_{d}$, that will be useful to us in quantifying our requirement on coincident phase fronts through a condition known as transverse resonance. This condition states that the net phase shift measured during a round trip over the full transverse dimension of the guide must be an integer multiple of $2\pi$ radians. This is another way of stating that all upward-(or downward-) propagating plane waves must have coincident phases. The various segments of this round trip are illustrated in Figure 13.15. We assume for this exercise that the waves are frozen in time and that an observer moves vertically over the round trip, measuring phase shift along the way. In the first segment (Figure 13.15a), the observer starts at a position just above the lower conductor and moves vertically to the top conductor through distance $d$. The measured phase shift over this distance is $\kappa_{m}d$ rad. On reaching the top surface, the observer will note a poss

[Truncated for analysis]

#### Page 485

![Page 485 figure 1](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-485-figure-1.png)

Figure 13.15 The net phase shift over a round trip in the parallel-plate guide is found by first measuring the transverse phase shift between plates of the initial upward wave (a); next, the transverse phase shift in the reflected (downward) wave is measured, while accounting for the reflective phase shift at the top plate (b); finally, the phase shift on reflection at the bottom plate is added, thus returning to the starting position, but with a new upward wave (c). Transverse resonance occurs if the phase at the final point is the same as that at the starting point (the two upward waves are in phase).

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

- Transverse resonance requires a round-trip phase shift of $2m\pi$.
- Each one-way transverse propagation contributes $\kappa_m d$ radians.
- Each conductor reflection contributes phase $\phi$.
- TE and TM reflection phases differ, but their round-trip contributions do not change the final quantization.
- The allowed transverse constants are $\kappa_m=m\pi/d$.
- The allowed angle satisfies $\cos\theta_m=m\lambda/(2nd)$.
- Increasing $m$ increases the required transverse phase variation.

## Source Anchors

- Figure 13.15 divides the round trip into upward traversal, top reflection, downward traversal, and bottom reflection.
- Equation (37) states $\kappa_m d+\phi+\kappa_m d+\phi=2m\pi$.
- Equation (38) gives $\kappa_m=m\pi/d$ for both TE and TM modes.
- Equation (39) gives the allowed angle in terms of $k$, $\omega$, $n$, $d$, and free-space wavelength $\lambda$.
- Problem D13.5 reports the first four angles as $76^\circ$, $60^\circ$, $41^\circ$, and $0^\circ$ for the stated air-filled guide.

## Related Pages

- [[plane-wave-model-of-guided-modes|Plane-Wave Model of Guided Modes]]
- [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
- [[parallel-plate-wave-equation-eigenmodes|Parallel-Plate Wave-Equation Eigenmodes]]

## Concept Dependencies

- enables: [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
- related: [[parallel-plate-wave-equation-eigenmodes|Parallel-Plate Wave-Equation Eigenmodes]]
