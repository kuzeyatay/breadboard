---
title: "Phase and Group Velocities in a Waveguide"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "phase-and-group-velocities-in-a-waveguide"
locations: ["Page 489, Equations (53) through (57)", "Page 494, Problem D13.8"]
related: ["parallel-plate-mode-propagation-and-cutoff", "modal-delay-and-waveguide-dispersion", "below-cutoff-evanescent-fields"]
---

## ConceptNode: Phase and Group Velocities in a Waveguide

Planning node for [[phase-and-group-velocities-in-a-waveguide|1.276 Phase and Group Velocities in a Waveguide]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 489, Equations (53) through (57), Page 494, Problem D13.8

The constituent plane-wave angle connects cutoff behavior to axial phase and energy transport. The source derives $$\cos\theta_m=\frac{\omega_{cm}}{\omega}=\frac{\lambda}{\lambda_{cm}}.$$ At cutoff, $\theta_m=0$, so the constituent waves bounce directly across the guide without forward progress. Far above cutoff, $\theta_m$ approaches $90^\circ$. Since $$\beta_m=k\sin\theta_m=\frac{n\omega}{c}\sin\theta_m,$$ the axial phase velocity is $$v_{pm}=\frac{\omega}{\beta_m}=\frac{c}{n\sin\theta_m}.$$ It approaches infinity near cutoff and approaches $c/n$ far above cutoff. This superluminal phase velocity does not represent energy or information transport. Differentiating the dispersion relation gives the group velocity $$v_{gm}=\frac{d\omega}{d\beta_m}=\frac{c}{n}\sqrt{1-\left(\frac{\omega_{cm}}{\omega}\right)^2}=\frac{c}{n}\sin\theta_m.$$ Group velocity is the axial projection of the constituent wave velocity and never exceeds $c/n$.

### Key planning details

- At cutoff, the constituent waves make no axial progress.
- The relation $\cos\theta_m=\omega_{cm}/\omega$ connects angle and normalized frequency.
- The axial phase constant is $\beta_m=(n\omega/c)\sin\theta_m$.
- Phase velocity is $v_{pm}=c/(n\sin\theta_m)$.
- Phase velocity diverges as cutoff is approached.
- Group velocity is $v_{gm}=(c/n)\sin\theta_m$.
- Group velocity approaches zero at cutoff.
- Group velocity approaches $c/n$ far above cutoff.

### Source coverage

- Equation (53) relates $\theta_m$ to cutoff frequency and wavelength.
- Equation (54) gives $\beta_m=(n\omega/c)\sin\theta_m$.
- Equation (55) gives the modal phase velocity.
- Equations (56) and (57) derive the group velocity from $d\omega/d\beta_m$.
- Problem D13.8 gives group velocities of zero, $2.6\times10^8\ \text{m/s}$, and $2.9\times10^8\ \text{m/s}$ at 30, 60, and 100 GHz for the stated guide.
