---
title: "1.362 Dipole Relaxation Susceptibility"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 588, time-harmonic orientational response", "Page 589, Equation (E.23)"]
related: ["permanent-dipole-orientation", "microwave-absorption-by-polar-water", "additive-susceptibility-of-multi-mechanism-materials", "resonant-susceptibility-and-complex-permittivity"]
---

# 1.362 Dipole Relaxation Susceptibility

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 588, time-harmonic orientational response, Page 589, Equation (E.23)

In a time-harmonic field, permanent molecular dipoles repeatedly attempt to reverse their orientation as the field reverses. Thermal motion opposes this ordered alignment and acts like a restoring or viscous influence. At low frequencies, each half-cycle lasts long enough for a relatively large orientational polarization to develop. As frequency rises, the field reverses before the dipoles can align fully, so the polarization amplitude decreases. Unlike the Lorentz electron oscillator, this process has no resonant frequency and behaves like an overdamped response. Its complex susceptibility is
$$
\chi_{\mathrm{rel}}=\frac{Np^2/\epsilon_0}{3k_BT(1+j\omega\tau)}
$$
 where $N$ is molecular number density, $p$ is each molecule's permanent dipole magnitude, $k_B$ is Boltzmann's constant, $T$ is absolute temperature in kelvins, $\omega$ is driving angular frequency, and $\tau$ is the thermal randomization time. The parameter $\tau$ is the time for polarization to decay to $1/e$ of its initial value after the field is removed. The response has the same mathematical form as a sinusoidally driven series RC circuit with time constant $RC$.

## Page-Grounded Details

#### Page 588

Figure E.3 Idealized sketches of ensembles of polar molecules under conditions of (a) random orientation of the dipole moments, and (b) dipole moments aligned under the influence of an applied electric field. Conditions in (b) are greatly exaggerated, since typically only a very small percentage of the dipoles align themselves with the field. But still enough alignment occurs to produce measurable changes in the material properties.

to fully describe the medium polarization properties, but the results of such studies often reduce to those of the spring model when field amplitudes are very low.

Another way that a dielectric can respond to an electric field is through the orientation of molecules that possess permanent dipole moments. In such cases, the molecules must be free to move or rotate, and so the material is typically a liquid or a gas. Figure E.3 shows an arrangement of polar molecules in a liquid (such as water) in which there is no applied field (Figure E.3$a$) and where an electric field is present (Figure E.3$b$). Applying the field causes the dipole moments, previously having random orientations, to line up, and so a net material polarization, $\mathbf{P}$, res

[Truncated for analysis]

#### Page 589

The complex susceptibility associated with dipole relaxation is essentially that of an "overdamped" oscillator, and is given by
$$
\chi_{\rm rel}=\frac{Np^{2}/\epsilon_{0}}{3\,k_{B}\,T(1+j\omega\tau)}\quad{(E.23)}
$$
where $p$ is the permanent dipole moment magnitude of each molecule, $k_{B}$ is Boltzmann's constant, and $T$ is the temperature in degees Kelvin. $\tau$ is the thermal randomization time, defined as the time for the polarization, P, to relax to 1/e of its original value when the field is turned off. $\chi_{\rm rel}$ is complex, and so it will possess absorptive and dispersive components (imaginary and real parts) as we found in the resonant case. The form of Eq. (E.23) is identical to that of the response of a series RC circuit driven by a sinusoidal voltage (where $\tau$ becomes RC).

Microwave absorption in water occurs through the relaxation mechanism in polar water molecules, and is the primary means by which microwave cooking is done, as discussed in Chapter 11. Frequencies near 2.5 GHz are typically used, since these provide the optimum penetration depth. The peak water absorption arising from dipole relaxation occurs at much higher frequencies, ho

[Truncated for analysis]

## Core Ideas

- Thermal motion opposes ordered molecular alignment.
- Low-frequency fields permit more complete alignment during each cycle.
- Polarization amplitude decreases as frequency increases.
- Dipole relaxation has no resonant frequency.
- The susceptibility contains the relaxation factor $1/(1+j\omega\tau)$.
- $\tau$ is the $1/e$ polarization-decay time after field removal.
- The response is analogous to a series RC circuit with time constant $RC$.

## Source Anchors

- Page 588 describes thermal motion as both a restoring influence and an effective viscous force.
- The source states that alignment is more complete at lower frequencies and weakens as frequency rises.
- The source explicitly states that no resonant frequency is associated with dipole relaxation.
- Equation (E.23):
$$
\chi_{\mathrm{rel}}=\frac{Np^2/\epsilon_0}{3k_BT(1+j\omega\tau)}
$$
- $\tau$ is defined as the time for $P$ to relax to $1/e$ of its original value after the field is turned off.
- The response is compared with a sinusoidally driven series RC circuit.

## Related Pages

- [[permanent-dipole-orientation|Permanent-Dipole Orientation]]
- [[microwave-absorption-by-polar-water|Microwave Absorption by Polar Water]]
- [[additive-susceptibility-of-multi-mechanism-materials|Additive Susceptibility of Multi-Mechanism Materials]]
- [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]

## Concept Dependencies

- depends-on: [[permanent-dipole-orientation|Permanent-Dipole Orientation]]
- contrasts-with: [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
