---
title: "1.356 Driven-Oscillator Equation and Phasor Solution"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 585, Equations (E.10) through (E.12)", "Page 586, Equations (E.13) and (E.14)"]
related: ["lorentz-bound-electron-oscillator", "damping-and-dephasing-of-bound-electrons", "resonant-susceptibility-and-complex-permittivity"]
---

# 1.356 Driven-Oscillator Equation and Phasor Solution

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 585, Equations (E.10) through (E.12), Page 586, Equations (E.13) and (E.14)

Newton's second law combines the electric driving force, spring restoring force, and damping force into the Lorentz oscillator equation. For complex field amplitude $E_c$, the displacement satisfies
$$
m\frac{\partial^2 d_c}{\partial t^2}+m\gamma_d\frac{\partial d_c}{\partial t}+k_s d_c=-eE_c
$$
 Dividing by $m$ and using $\omega_0^2=k_s/m$ expresses the mechanical response in terms of the natural frequency. For sinusoidal steady state, time differentiation is replaced by multiplication by $j\omega$, producing the phasor equation
$$
-\omega^2d_s+j\omega\gamma_d d_s+\omega_0^2d_s=-\frac{e}{m}E_s
$$
 Solving for displacement gives
$$
d_s=\frac{-(e/m)E_s}{(\omega_0^2-\omega^2)+j\omega\gamma_d}
$$
 The denominator contains the competition between natural and driving frequencies in its real term and damping in its imaginary term. This complex denominator determines both the displacement amplitude and its phase relative to the field. It is the direct mathematical origin of the complex resonant susceptibility.

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

#### Page 586

With the waves in this form, time differentiation produces a factor of $j\omega$. Consequently (E.11) can be simplified and rewritten in phasor form:
$$
-\omega^{2}d_{s}+j\omega\gamma_{d}d_{s}+\omega_{0}^{2}d_{s}=-\frac{e}{m}E_{s}\qquad(E.13)
$$
where (E.4) has been used. We now solve (E.13) for $d_{s}$, obtaining
$$
d_{s}=\frac{-(e/m)\,E_{s}}{\left(\omega_{0}^{2}-\omega^{2}\right)+j\omega\gamma_{d}}\qquad(E.14)
$$
The dipole moment associated with displacement $d_{s}$ is
$$
p_{s}=-e\,d_{s}\qquad(E.15)
$$
The polarization of the medium is then found, assuming that all dipoles are identical. Eq. (E.1) thus becomes
$$
P_{s}=N\,p_{s}
$$
which, when using (E.14) and (E.15), becomes
$$
P_{s}=\frac{Ne^{2}/m}{\left(\omega_{0}^{2}-\omega^{2}\right)+j\omega\gamma_{d}}E_{s}\qquad(E.16)
$$
Now, using (E.3) we identify the susceptibility associated with the resonance as
$$
\chi_{\text{res}}=\frac{Ne^{2}}{\epsilon_{0}m}\frac{1}{\left(\omega_{0}^{2}-\omega^{2}\right)+j\omega\gamma_{d}}=\chi_{\text{res}}^{\prime}-j\chi_{\text{res}}^{\prime}\qquad(E.17)
$$
The real and imaginary parts of the permittivity are now found through the real and imaginary parts of $\chi_{\text{res}}$ :

[Truncated for analysis]

## Core Ideas

- Newton's second law sums the applied, restoring, and damping forces.
- The time-domain response is a second-order linear differential equation.
- The identity $\omega_0^2=k_s/m$ replaces the spring-to-mass ratio.
- Sinusoidal differentiation introduces factors of $j\omega$.
- The displacement denominator is $(\omega_0^2-\omega^2)+j\omega\gamma_d$.
- The complex displacement records both response magnitude and phase lag.

## Source Anchors

- Equation (E.10) gives the complex driving field as a spatially propagating harmonic field.
- Equation (E.11):
$$
m\frac{\partial^2d_c}{\partial t^2}+m\gamma_d\frac{\partial d_c}{\partial t}+k_s d_c=-eE_c
$$
- Equation (E.13):
$$
-\omega^2d_s+j\omega\gamma_d d_s+\omega_0^2d_s=-\frac{e}{m}E_s
$$
- Equation (E.14):
$$
d_s=\frac{-(e/m)E_s}{(\omega_0^2-\omega^2)+j\omega\gamma_d}
$$
- The source states that time differentiation of harmonic waves produces a factor of $j\omega$.

## Related Pages

- [[lorentz-bound-electron-oscillator|Lorentz Bound-Electron Oscillator]]
- [[damping-and-dephasing-of-bound-electrons|Damping and Dephasing of Bound Electrons]]
- [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]

## Concept Dependencies

- derives-from: [[lorentz-bound-electron-oscillator|Lorentz Bound-Electron Oscillator]]
- depends-on: [[damping-and-dephasing-of-bound-electrons|Damping and Dephasing of Bound Electrons]]
