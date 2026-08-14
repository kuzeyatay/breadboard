---
title: "1.266 Dispersion Relation, Phase Velocity, and Group Velocity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 455", "Section 12.7: Wave Propagation in Dispersive Media"]
related: ["frequency-dependent-refractive-index-angular-dispersion", "refractive-index-material-wave-parameters", "wavevector-representation-general-plane-waves"]
---

# 1.266 Dispersion Relation, Phase Velocity, and Group Velocity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 455, Section 12.7: Wave Propagation in Dispersive Media

In a lossless, nonmagnetic dispersive medium, the phase constant depends on angular frequency through both the explicit frequency factor and the frequency-dependent refractive index. The source writes this relation as $\beta(\omega)=n(\omega)\omega/c$. Plotting angular frequency against phase constant produces an $\omega$-$\beta$ diagram, which summarizes how monochromatic components propagate. At a selected frequency $\omega_0$, the line from the origin to the corresponding point on the curve has slope $\omega_0/\beta_0$, which is the phase velocity. The tangent to the curve at the same point has slope $d\omega/d\beta$, identified by Figure 12.12 as the group velocity. The text begins a two-frequency construction using equal-amplitude waves at $\omega_a$ and $\omega_b$, with midpoint frequency $\omega_0$ and corresponding phase constants $\beta_a$, $\beta_b$, and $\beta_0$. Their superposition is the starting point for interpreting envelope motion and temporal dispersion. The extracted chunk ends before that addition is completed, so the durable result available here is the dispersion relation and the geometric distinction between phase-velocity and group-velocity slopes.

## Page-Grounded Details

#### Page 455

Figure 12.12 $\omega-\beta$ diagram for a material in which the refractive index increases with frequency. The slope of a line tangent to the curve at $\omega_{0}$ is the group velocity at that frequency. The slope of a line joining the origin to the point on the curve at $\omega_{0}$ is the phase velocity at $\omega_{0}$.

It is important for us to think of wave power as subdivided into spectral packets in this way because it will figure prominently in our interpretation of the main topic of this section, which is wave dispersion in time.

We now consider a lossless nonmagnetic medium in which the refractive index varies with frequency. The phase constant of a uniform plane wave in this medium will assume the form
$$
\beta(\omega)=k=\omega\sqrt{\mu_{0}\epsilon(\omega)}=n(\omega)\frac{\omega}{c}\quad{(80)}
$$
If we take $n(\omega)$ to be a monotonically increasing function of frequency (as is usually the case), a plot of $\omega$ versus $\beta$ would look something like the curve shown in Figure 12.12. Such a plot is known as an $\omega$-$\beta$ diagram for the medium. Much can be learned about how waves propagate in the material by considering the shape of the

[Truncated for analysis]

## Core Ideas

- The dispersive phase constant is $\beta(\omega)=n(\omega)\omega/c$.
- An $\omega$-$\beta$ curve is the medium's dispersion diagram.
- Phase velocity at $\omega_0$ is represented by the origin-to-curve slope $\omega_0/\beta_0$.
- Group velocity is represented by the tangent slope $d\omega/d\beta$.
- A nonlinear $\omega$-$\beta$ relation distinguishes group and phase velocities.
- Two nearby co-propagating frequencies provide the basis for an envelope interpretation.
- The source labels midpoint quantities $\omega_0$ and $\beta_0$ between the two components.

## Source Anchors

- Equation (80) gives
$$
\beta(\omega)=k=\omega\sqrt{\mu_0\epsilon(\omega)}=n(\omega)\frac{\omega}{c}
$$
- Figure S1.P455.F1, corresponding to Figure 12.12, shows an $\omega$-$\beta$ curve for index increasing with frequency.
- Figure 12.12 identifies the tangent slope at $\omega_0$ as group velocity.
- Figure 12.12 identifies the slope from the origin to the point at $\omega_0$ as phase velocity.
- Page 455 introduces two equal-amplitude co-propagating waves at $\omega_a$ and $\omega_b$.
- The midpoint frequency $\omega_0$ and phase constants $\beta_a$, $\beta_b$, and $\beta_0$ are labeled on the diagram.

## Related Pages

- [[frequency-dependent-refractive-index-angular-dispersion|Frequency-Dependent Refractive Index and Angular Dispersion]]
- [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
- [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]

## Concept Dependencies

- depends-on: [[frequency-dependent-refractive-index-angular-dispersion|Frequency-Dependent Refractive Index and Angular Dispersion]]
- related: [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
