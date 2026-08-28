---
title: "Driven-Oscillator Equation and Phasor Solution"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "driven-oscillator-equation-and-phasor-solution"
locations: ["Page 585, Equations (E.10) through (E.12)", "Page 586, Equations (E.13) and (E.14)"]
related: ["lorentz-bound-electron-oscillator", "damping-and-dephasing-of-bound-electrons", "resonant-susceptibility-and-complex-permittivity"]
---

## ConceptNode: Driven-Oscillator Equation and Phasor Solution

Planning node for [[driven-oscillator-equation-and-phasor-solution|1.356 Driven-Oscillator Equation and Phasor Solution]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 585, Equations (E.10) through (E.12), Page 586, Equations (E.13) and (E.14)

Newton's second law combines the electric driving force, spring restoring force, and damping force into the Lorentz oscillator equation. For complex field amplitude $E_c$, the displacement satisfies $$m\frac{\partial^2 d_c}{\partial t^2}+m\gamma_d\frac{\partial d_c}{\partial t}+k_s d_c=-eE_c.$$ Dividing by $m$ and using $\omega_0^2=k_s/m$ expresses the mechanical response in terms of the natural frequency. For sinusoidal steady state, time differentiation is replaced by multiplication by $j\omega$, producing the phasor equation $$-\omega^2d_s+j\omega\gamma_d d_s+\omega_0^2d_s=-\frac{e}{m}E_s.$$ Solving for displacement gives $$d_s=\frac{-(e/m)E_s}{(\omega_0^2-\omega^2)+j\omega\gamma_d}.$$ The denominator contains the competition between natural and driving frequencies in its real term and damping in its imaginary term. This complex denominator determines both the displacement amplitude and its phase relative to the field. It is the direct mathematical origin of the complex resonant susceptibility.

### Key planning details

- Newton's second law sums the applied, restoring, and damping forces.
- The time-domain response is a second-order linear differential equation.
- The identity $\omega_0^2=k_s/m$ replaces the spring-to-mass ratio.
- Sinusoidal differentiation introduces factors of $j\omega$.
- The displacement denominator is $(\omega_0^2-\omega^2)+j\omega\gamma_d$.
- The complex displacement records both response magnitude and phase lag.

### Source coverage

- Equation (E.10) gives the complex driving field as a spatially propagating harmonic field.
- Equation (E.11): $$m\frac{\partial^2d_c}{\partial t^2}+m\gamma_d\frac{\partial d_c}{\partial t}+k_s d_c=-eE_c.$$
- Equation (E.13): $$-\omega^2d_s+j\omega\gamma_d d_s+\omega_0^2d_s=-\frac{e}{m}E_s.$$
- Equation (E.14): $$d_s=\frac{-(e/m)E_s}{(\omega_0^2-\omega^2)+j\omega\gamma_d}.$$
- The source states that time differentiation of harmonic waves produces a factor of $j\omega$.
