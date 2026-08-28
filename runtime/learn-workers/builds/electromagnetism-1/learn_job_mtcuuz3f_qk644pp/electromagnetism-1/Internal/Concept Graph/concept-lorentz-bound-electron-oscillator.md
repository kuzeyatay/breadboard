---
title: "Lorentz Bound-Electron Oscillator"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lorentz-bound-electron-oscillator"
locations: ["Page 584, Lorentz model discussion and Figure E.1", "Page 585, Equations (E.6) through (E.8)"]
related: ["time-harmonic-polarization-waves", "damping-and-dephasing-of-bound-electrons", "driven-oscillator-equation-and-phasor-solution"]
---

## ConceptNode: Lorentz Bound-Electron Oscillator

Planning node for [[lorentz-bound-electron-oscillator|1.354 Lorentz Bound-Electron Oscillator]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 584, Lorentz model discussion and Figure E.1, Page 585, Equations (E.6) through (E.8)

The Lorentz model represents a dielectric as an ensemble of identical, fixed electron oscillators. Each bound electron is attached to a positive nucleus by an effective spring that models the Coulomb binding force. For the geometry in Figure E.1, an $x$-polarized plane wave propagates in the $z$ direction and displaces an electron along $x$ by $\mathbf{d}(z,t)$. Because the electron charge is $-e$, with $e$ treated as a positive magnitude, the resulting dipole moment is $$\mathbf{p}(z,t)=-e\mathbf{d}(z,t).$$ The field exerts the applied force $$F_a(z,t)=-eE(z,t),$$ while the spring supplies the restoring force $$F_r(z,t)=-k_s d(z,t).$$ Here $k_s$ is the spring constant and must not be confused with a wave propagation constant. If the driving field is removed and damping is neglected, the electron oscillates at its natural angular frequency $$\omega_0=\sqrt{\frac{k_s}{m}},$$ where $m$ is the electron mass. This mechanical analogy converts microscopic charge dynamics into a tractable driven-oscillator problem.

### Key planning details

- The Lorentz model uses identical fixed electron oscillators.
- Coulomb binding is represented by a spring with constant $k_s$.
- The dipole moment is opposite the electron displacement: $\mathbf{p}=-e\mathbf{d}$.
- The electric force on the electron is $F_a=-eE$.
- The restoring force follows Hooke's law: $F_r=-k_s d$.
- The undamped natural frequency is $\omega_0=\sqrt{k_s/m}$.

### Source coverage

- Source figure S1.P584.F1, Figure E.1, depicts the nucleus, displaced electron, effective spring, displacement $d$, and applied electric field.
- Equation (E.5): $$\mathbf{p}(z,t)=-e\mathbf{d}(z,t).$$
- Equation (E.6): $$F_a(z,t)=-eE(z,t).$$
- Equation (E.7): $$F_r(z,t)=-k_s d(z,t).$$
- Equation (E.8): $$\omega_0=\sqrt{k_s/m}.$$
- The incident plane wave is described as $x$ polarized and propagating in the $z$ direction.
