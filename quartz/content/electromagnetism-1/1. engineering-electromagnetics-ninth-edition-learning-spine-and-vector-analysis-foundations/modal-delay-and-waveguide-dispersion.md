---
title: "1.277 Modal Delay and Waveguide Dispersion"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 489, Example 13.3", "Page 490, Example 13.3 solution", "Page 493, Figure 13.17 and waveguide-dispersion discussion"]
related: ["phase-and-group-velocities-in-a-waveguide", "parallel-plate-wave-equation-eigenmodes", "counting-propagating-parallel-plate-modes"]
---

# 1.277 Modal Delay and Waveguide Dispersion

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 489, Example 13.3, Page 490, Example 13.3 solution, Page 493, Figure 13.17 and waveguide-dispersion discussion

Different waveguide modes generally have different cutoff frequencies and therefore different group velocities at the same operating frequency. Energy distributed among those modes arrives at different times, causing modal dispersion and pulse broadening. Example 13.3 considers the Teflon-filled parallel-plate guide at $25\ \text{GHz}$, where the $m=1$ and $m=2$ modes are above cutoff. Their group velocities are calculated as $v_{g1}=0.63c$ and $v_{g2}=0.39c$. Over a distance of $1\ \text{cm}$, the delay difference is
$$
\Delta t=\left(\frac{1}{v_{g2}}-\frac{1}{v_{g1}}\right)(1\ \text{cm})=33\ \text{ps/cm}
$$
 A pulse whose energy occupies both modes broadens by approximately this amount per centimeter. Including the cutoff-free TEM mode increases the relevant difference because its group velocity is $c/\sqrt{2.1}$. The delay between TEM and the $m=2$ mode becomes $52\ \text{ps/cm}$. Waveguide dispersion also exists within a single mode because its group velocity changes with frequency.

## Page-Grounded Details

#### Page 489

We note from (39) and (41) that the plane wave angle is related to the cutoff frequency and cutoff wavelength through
$$
\cos\theta_{m}=\frac{\omega_{cm}}{\omega}=\frac{\lambda}{\lambda_{cm}}\quad{(53)}
$$
So we see that at cutoff ($\omega=\omega_{cm}$), $\theta_{m}=0$, and the plane waves are just reflecting back and forth over the cross section; they are making no forward progress down the guide. As $\omega$ is increased beyond cutoff (or $\lambda$ is decreased), the wave angle increases, approaching $90^{\circ}$ as $\omega$ approaches infinity (or as $\lambda$ approaches zero). From Figure 13.14, we have
$$
\beta_{m}=k\sin\theta_{m}=\frac{n\omega}{c}\sin\theta_{m}\quad{(54)}
$$
and so the phase velocity of mode $m$ will be
$$
v_{pm}=\frac{\omega}{\beta_{m}}=\frac{c}{n\sin\theta_{m}}\quad{(55)}
$$
The velocity minimizes at $c/n$ for all modes, approaching this value at frequencies far above cutoff; $v_{pm}$ approaches infinity as the frequency is reduced to approach the cutoff frequency. Again, phase velocity is the speed of the phases in the $z$ direction, and the fact that this velocity may exceed the speed of light in the medium is not a violation o

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

#### Page 493

Figure 13.17 (a) A plane wave associated with an $m=4$ mode, showing a net phase shift of $4\pi$ (two wavelengths measured in $x$) occurring over distance $d$ in the transverse plane. (b) As frequency increases, an increase in wave angle is required to maintain the $4\pi$ transverse phase shift.

Now, as the frequency increases, wavelength will decrease, and so the requirement of wavelength equaling an integer multiple of $2d$ is no longer met. The response of the mode is to establish $z$ components of $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$, which results in the decreased wavelength being compensated by an increase in wavelength as measured in the $x$ direction. Figure 13.17 shows this effect for the $m=4$ mode, in which the wave angle, $\theta_{4}$, steadily increases with increasing frequency. Thus, the mode retains precisely the functional form of its field in the $x$ direction, but it establishes an increasing value of $\beta_{m}$ as the frequency is raised. This invariance in the transverse spatial pattern means that the mode will retain its identity at all frequencies. Group velocity, expressed in (57), is changing as well, meaning that the changing

[Truncated for analysis]

## Core Ideas

- Modes with different cutoff frequencies have different group velocities.
- Differential modal delay causes pulse broadening.
- At 25 GHz, the example gives $v_{g1}=0.63c$.
- At 25 GHz, the example gives $v_{g2}=0.39c$.
- The $m=1$ to $m=2$ delay difference is $33\ \text{ps/cm}$.
- Including TEM increases the net example delay to $52\ \text{ps/cm}$.
- Frequency dependence of group velocity also produces intramodal waveguide dispersion.

## Source Anchors

- Example 13.3 states that $m=1$ and $m=2$ are above cutoff at $25\ \text{GHz}$.
- The calculated group velocities are $0.63c$ and $0.39c$.
- The source obtains $\Delta t=3.3\times10^{-11}\ \text{s/cm}=33\ \text{ps/cm}$.
- The pulse example describes energy separation and broadening during propagation.
- Including TEM gives $\Delta t_{\text{net}}=52\ \text{ps/cm}$.
- Figure 13.17 and its discussion identify changing wave angle with frequency as the mechanism of waveguide dispersion.

## Related Pages

- [[phase-and-group-velocities-in-a-waveguide|Phase and Group Velocities in a Waveguide]]
- [[parallel-plate-wave-equation-eigenmodes|Parallel-Plate Wave-Equation Eigenmodes]]
- [[counting-propagating-parallel-plate-modes|Counting Propagating Parallel-Plate Modes]]

## Concept Dependencies

- depends-on: [[counting-propagating-parallel-plate-modes|Counting Propagating Parallel-Plate Modes]]
