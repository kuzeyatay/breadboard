---
title: "1.276 Phase and Group Velocities in a Waveguide"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 489, Equations (53) through (57)", "Page 494, Problem D13.8"]
related: ["parallel-plate-mode-propagation-and-cutoff", "modal-delay-and-waveguide-dispersion", "below-cutoff-evanescent-fields"]
---

# 1.276 Phase and Group Velocities in a Waveguide

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 489, Equations (53) through (57), Page 494, Problem D13.8

The constituent plane-wave angle connects cutoff behavior to axial phase and energy transport. The source derives
$$
\cos\theta_m=\frac{\omega_{cm}}{\omega}=\frac{\lambda}{\lambda_{cm}}
$$
 At cutoff, $\theta_m=0$, so the constituent waves bounce directly across the guide without forward progress. Far above cutoff, $\theta_m$ approaches $90^\circ$. Since
$$
\beta_m=k\sin\theta_m=\frac{n\omega}{c}\sin\theta_m
$$
 the axial phase velocity is
$$
v_{pm}=\frac{\omega}{\beta_m}=\frac{c}{n\sin\theta_m}
$$
 It approaches infinity near cutoff and approaches $c/n$ far above cutoff. This superluminal phase velocity does not represent energy or information transport. Differentiating the dispersion relation gives the group velocity
$$
v_{gm}=\frac{d\omega}{d\beta_m}=\frac{c}{n}\sqrt{1-\left(\frac{\omega_{cm}}{\omega}\right)^2}=\frac{c}{n}\sin\theta_m
$$
 Group velocity is the axial projection of the constituent wave velocity and never exceeds $c/n$.

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

#### Page 494

We solve for $H_{s}$ by dividing both sides of (69) by $-j\omega\mu$. Performing this operation on (70), we obtain the two magnetic field components:
$$
H_{xs}=-\frac{\beta_{m}}{\omega\mu}E_{0}\sin(\kappa_{m}x)e^{-j\beta_{m}z}
$$
(71)
$$
H_{zs}=j\frac{\kappa_{m}}{\omega\mu}E_{0}\cos(\kappa_{m}x)e^{-j\beta_{m}z}
$$
(72)

Together, these two components form closed-loop patterns for $H_{s}$ in the x, z plane, as can be verified using the streamline plotting methods developed in Section 2.6.

It is interesting to consider the magnitude of $H_{s}$, which is found through
$$
|H_{s}|=\sqrt{H_{s}\cdot H_{s}^{*}}=\sqrt{H_{xs}H_{xs}^{*}+H_{zs}H_{zs}^{*}}
$$
(73)

Carrying this out using (71) and (72) results in
$$
|H_{s}|=\frac{E_{0}}{\omega\mu}(\kappa_{m}^{2}+\beta_{m}^{2})^{1/2}(\sin^{2}(\kappa_{m}x)+\cos^{2}(\kappa_{m}x))^{1/2}
$$
(74)

Using the fact that $\kappa_{m}^{2}+\beta_{m}^{2}=k^{2}$ and using the identity $\sin^{2}(\kappa_{m}x)+\cos^{2}(\kappa_{m}x)=1$, (74) becomes
$$
|H_{s}|=\frac{k}{\omega\mu}E_{0}=\frac{\omega\sqrt{\mu\epsilon}}{\omega\mu}=\frac{E_{0}}{\eta}
$$
(75)

where $\eta=\sqrt{\mu/\epsilon}$. This result is consistent with our understanding of

[Truncated for analysis]

## Core Ideas

- At cutoff, the constituent waves make no axial progress.
- The relation $\cos\theta_m=\omega_{cm}/\omega$ connects angle and normalized frequency.
- The axial phase constant is $\beta_m=(n\omega/c)\sin\theta_m$.
- Phase velocity is $v_{pm}=c/(n\sin\theta_m)$.
- Phase velocity diverges as cutoff is approached.
- Group velocity is $v_{gm}=(c/n)\sin\theta_m$.
- Group velocity approaches zero at cutoff.
- Group velocity approaches $c/n$ far above cutoff.

## Source Anchors

- Equation (53) relates $\theta_m$ to cutoff frequency and wavelength.
- Equation (54) gives $\beta_m=(n\omega/c)\sin\theta_m$.
- Equation (55) gives the modal phase velocity.
- Equations (56) and (57) derive the group velocity from $d\omega/d\beta_m$.
- Problem D13.8 gives group velocities of zero, $2.6\times10^8\ \text{m/s}$, and $2.9\times10^8\ \text{m/s}$ at 30, 60, and 100 GHz for the stated guide.

## Related Pages

- [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
- [[modal-delay-and-waveguide-dispersion|Modal Delay and Waveguide Dispersion]]
- [[below-cutoff-evanescent-fields|Below-Cutoff Evanescent Fields]]

## Concept Dependencies

- causes: [[modal-delay-and-waveguide-dispersion|Modal Delay and Waveguide Dispersion]]
- contrasts-with: [[below-cutoff-evanescent-fields|Below-Cutoff Evanescent Fields]]
