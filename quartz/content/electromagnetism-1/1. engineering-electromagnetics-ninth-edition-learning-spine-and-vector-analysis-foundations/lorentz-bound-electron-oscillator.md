---
title: "1.354 Lorentz Bound-Electron Oscillator"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 584, Lorentz model discussion and Figure E.1", "Page 585, Equations (E.6) through (E.8)"]
related: ["time-harmonic-polarization-waves", "damping-and-dephasing-of-bound-electrons", "driven-oscillator-equation-and-phasor-solution"]
---

# 1.354 Lorentz Bound-Electron Oscillator

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 584, Lorentz model discussion and Figure E.1, Page 585, Equations (E.6) through (E.8)

The Lorentz model represents a dielectric as an ensemble of identical, fixed electron oscillators. Each bound electron is attached to a positive nucleus by an effective spring that models the Coulomb binding force. For the geometry in Figure E.1, an $x$-polarized plane wave propagates in the $z$ direction and displaces an electron along $x$ by $\mathbf{d}(z,t)$. Because the electron charge is $-e$, with $e$ treated as a positive magnitude, the resulting dipole moment is
$$
\mathbf{p}(z,t)=-e\mathbf{d}(z,t)
$$
 The field exerts the applied force
$$
F_a(z,t)=-eE(z,t)
$$
 while the spring supplies the restoring force
$$
F_r(z,t)=-k_s d(z,t)
$$
 Here $k_s$ is the spring constant and must not be confused with a wave propagation constant. If the driving field is removed and damping is neglected, the electron oscillates at its natural angular frequency
$$
\omega_0=\sqrt{\frac{k_s}{m}}
$$
 where $m$ is the electron mass. This mechanical analogy converts microscopic charge dynamics into a tractable driven-oscillator problem.

## Page-Grounded Details

#### Page 584

Therefore, to understand the nature of $\epsilon_{r}$, we need to understand $\chi_{e}$, which in turn means that we need to explore the behavior of the polarization, $\mathbf{P}$.

Here, we consider the added complications of how the dipoles respond to a time-harmonic field that propagates as a wave through the material. The result of applying such a forcing function is that oscillating dipole moments are set up, and these in turn establish a polarization wave that propagates through the material. The effect is to produce a polarization function, $\mathbf{P}(z,t)$, having the same functional form as the driving field, $\mathbf{E}(z,t)$. The molecules themselves do not move through the material, but their oscillating dipole moments collectively exhibit wave motion, just as waves in pools of water are formed by the up-and-down motion of the water. From here, the description of the process gets complicated and in many ways beyond the scope of our present discussion. We can form a basic qualitative understanding, however, by considering the classical description of the process, which is that the dipoles, once oscillating, behave as microscopic antennas, re-radiating fields t

[Truncated for analysis]

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

## Core Ideas

- The Lorentz model uses identical fixed electron oscillators.
- Coulomb binding is represented by a spring with constant $k_s$.
- The dipole moment is opposite the electron displacement: $\mathbf{p}=-e\mathbf{d}$.
- The electric force on the electron is $F_a=-eE$.
- The restoring force follows Hooke's law: $F_r=-k_s d$.
- The undamped natural frequency is $\omega_0=\sqrt{k_s/m}$.

## Source Anchors

- Source figure S1.P584.F1, Figure E.1, depicts the nucleus, displaced electron, effective spring, displacement $d$, and applied electric field.
- Equation (E.5):
$$
\mathbf{p}(z,t)=-e\mathbf{d}(z,t)
$$
- Equation (E.6):
$$
F_a(z,t)=-eE(z,t)
$$
- Equation (E.7):
$$
F_r(z,t)=-k_s d(z,t)
$$
- Equation (E.8):
$$
\omega_0=\sqrt{k_s/m}
$$
- The incident plane wave is described as $x$ polarized and propagating in the $z$ direction.

## Related Pages

- [[time-harmonic-polarization-waves|Time-Harmonic Polarization Waves]]
- [[damping-and-dephasing-of-bound-electrons|Damping and Dephasing of Bound Electrons]]
- [[driven-oscillator-equation-and-phasor-solution|Driven-Oscillator Equation and Phasor Solution]]

## Concept Dependencies

- applies-to: [[time-harmonic-polarization-waves|Time-Harmonic Polarization Waves]]
