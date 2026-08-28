---
title: "1.355 Damping and Dephasing of Bound Electrons"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 585, damping and dephasing discussion", "Page 587, Figure E.2 interpretation"]
related: ["lorentz-bound-electron-oscillator", "driven-oscillator-equation-and-phasor-solution", "near-resonance-absorption-line-shape"]
---

# 1.355 Damping and Dephasing of Bound Electrons

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 585, damping and dephasing discussion, Page 587, Figure E.2 interpretation

A bound electron does not oscillate indefinitely because it interacts and collides with neighboring oscillators. The Lorentz model represents these effects with a velocity-dependent damping force,
$$
F_d(z,t)=-m\gamma_d v(z,t)
$$
 where $m$ is the electron mass, $v$ is its velocity, and $\gamma_d$ is the damping coefficient. Damping is associated with dephasing among the oscillators. While the applied sinusoidal field imposes a definite relative phase, collisions progressively destroy that phase relationship. After the field is removed, the organized response decays exponentially toward random phase. The source states that the $1/e$ dephasing time is $2/\gamma_d$. Because the damped oscillator is driven at angular frequency $\omega$, its displacement amplitude depends on frequency, much like the response of a sinusoidally driven RLC circuit. The damping coefficient therefore affects both the magnitude of the loss and the spectral width of the absorption response. In the resulting susceptibility curve, stronger damping produces a broader resonance feature.

## Page-Grounded Details

#### Page 585

where the electron charge, $e$, is treated as a positive quantity. The applied force is
$$
F_{a}(z,t)=-eE(z,t)\qquad(E.6)
$$
We need to remember that $E(z,t)$ at a given oscillator location is the net field, composed of the original applied field plus the radiated fields from all other oscillators. The relative phasing between oscillators is precisely determined by the spatial and temporal behavior of $E(z,t)$.

The restoring force on the electron, $F_{r}$, is that produced by the spring, which is assumed to obey Hooke's law:
$$
F_{r}(z,t)=-k_{s}d(z,t)\qquad(E.7)
$$
where $k_{s}$ is the spring constant (not to be confused with the propagation constant). If the field is turned off, the electron is released and will oscillate about the nucleus at the resonant frequency, given by
$$
\omega_{0}=\sqrt{k_{s}/m}\qquad(E.8)
$$
where $m$ is the mass of the electron. The oscillation, however, will be damped since the electron will experience forces and collisions from neighboring oscillators. We model these as a velocity-dependent damping force:
$$
F_{d}(z,t)=-m\gamma_{d}v(z,t)\qquad(E.9)
$$
where $v(z,t)$ is the electron velocity. Associated with this damping is the de

[Truncated for analysis]

#### Page 587

Figure E.2 Plots of the real and imaginary parts of the resonant susceptibility, $\chi_{\rm res}$, as given by Eq. (E.20). The full-width at half-maximum of the imaginary part, $\chi_{\rm res}^{\prime}$, is equal to the damping coefficient, $\gamma_{d}$.

Key features to note in Figure E.2 include the symmetric $\chi_{e}^{\prime\prime}$ function, whose full width at its half-maximum amplitude is $\gamma_{d}$. Near the resonant frequency, where $\chi_{\rm res}^{\prime\prime}$ maximizes, wave attenuation maximizes as seen from Eq. (44), Chapter 11. Additionally, we see that away from resonance, attenuation is relatively weak, and the material becomes transparent. As Figure E.2 shows, there is still significant variation of $\chi_{\rm res}^{\prime}$ with frequency away from resonance, which leads to a frequency-dependent refractive index; this is expressed approximately as
$$
n\doteq\sqrt{1+\chi_{\rm res}^{\prime}}\quad(away\ from\ resonance)\quad(E.22)
$$
This frequency-dependent $n$, arising from the material resonance, leads to phase and group velocities that also depend on frequency. Thus, group dispersion, leading to pulse-broadening effects as discussed in Chap

[Truncated for analysis]

## Core Ideas

- Neighbor interactions and collisions damp electron motion.
- The damping force is proportional to velocity.
- $F_d=-m\gamma_d v$ defines the damping coefficient $\gamma_d$.
- Collisions destroy the phase coherence imposed by the driving field.
- The stated $1/e$ dephasing time is $2/\gamma_d$.
- The driven response is frequency-dependent in a manner analogous to an RLC circuit.

## Source Anchors

- Equation (E.9):
$$
F_d(z,t)=-m\gamma_d v(z,t)
$$
- Page 585 states that oscillator phasing dies away exponentially after coherent driving is removed.
- The source gives the dephasing time as $2/\gamma_d$.
- The displacement magnitude is compared with the frequency response of a sinusoidally driven RLC circuit.
- Figure E.2 later connects $\gamma_d$ to the full width at half maximum of the absorption curve.

## Related Pages

- [[lorentz-bound-electron-oscillator|Lorentz Bound-Electron Oscillator]]
- [[driven-oscillator-equation-and-phasor-solution|Driven-Oscillator Equation and Phasor Solution]]
- [[near-resonance-absorption-line-shape|Near-Resonance Absorption Line Shape]]

## Concept Dependencies

- part-of: [[lorentz-bound-electron-oscillator|Lorentz Bound-Electron Oscillator]]
- causes: [[near-resonance-absorption-line-shape|Near-Resonance Absorption Line Shape]]
