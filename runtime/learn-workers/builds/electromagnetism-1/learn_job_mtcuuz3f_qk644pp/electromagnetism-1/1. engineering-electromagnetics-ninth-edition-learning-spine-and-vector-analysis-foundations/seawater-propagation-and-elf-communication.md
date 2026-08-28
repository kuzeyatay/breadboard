---
title: "1.231 Seawater Propagation and ELF Communication"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 404", "Page 405"]
related: ["good-conductor-propagation-approximation", "skin-depth-and-field-confinement", "conductivity-as-imaginary-permittivity"]
---

# 1.231 Seawater Propagation and ELF Communication

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 404, Page 405

Example 11.6 applies the good-conductor model to seawater, whose salt dissociates into mobile $\mathrm{Na}^+$ and $\mathrm{Cl}^-$ ions. At 1 MHz, the source uses $\sigma=4\ \mathrm{S/m}$ and $\epsilon'_r=81$. The calculated loss tangent is $\sigma/(\omega\epsilon')=8.9\times10^2$, confirming that seawater is a good conductor at this frequency and below. The resulting skin depth is $0.25\ \mathrm{m}$, wavelength is $\lambda=2\pi\delta=1.6\ \mathrm{m}$, and phase velocity is $v_p=\omega\delta=1.6\times10^6\ \mathrm{m/s}$. These values are dramatically smaller than the free-space wavelength of $300\ \mathrm{m}$ and velocity $c$. A 25 cm skin depth makes ordinary radio-frequency communication through seawater impractical. Because $\delta$ varies as $1/\sqrt{f}$, lowering the frequency to 10 Hz increases skin depth to about $80\ \mathrm{m}$ and gives a conductor wavelength near $500\ \mathrm{m}$. This supports submarine communication, but the enormous free-space wavelength requires very large transmitting antennas and the extremely low carrier frequency produces very slow data rates.

## Page-Grounded Details

#### Page 404

in one skin depth, about 8.5 mm.^6 A hollow conductor with a wall thickness of about 12 mm would be a much better design. Although we are applying the results of an analysis for an infinite planar conductor to one of finite dimensions, the fields are attenuated in the finite-size conductor in a similar (but not identical) fashion.

The extremely short skin depth at microwave frequencies shows that only the surface coating of the guiding conductor is important. A piece of glass with an evaporated silver surface 3 $\mu$m thick is an excellent conductor at these frequencies.

Expressions for the velocity and wavelength within a good conductor can be found. From (82), we already have
$$
\alpha=\beta=\frac{1}{\delta}=\sqrt{\pi f\mu\sigma}
$$
Then, as
$$
\beta=\frac{2\pi}{\lambda}
$$
we find the wavelength to be
$$
\lambda=2\pi\delta \quad{(83)}
$$
Also, recalling that
$$
v_{p}=\frac{\omega}{\beta}
$$
we have
$$
v_{p}=\omega\delta \quad{(84)}
$$
For copper at 60 Hz, $\lambda=5.36$ cm and $v_{p}=3.22$ m/s, or about 7.2 mi/h! A lot of us can run faster than that. In free space, of course, a 60 Hz wave has a wavelength of 3100 mi and travels at the velocity of light.

EXAMPL

[Truncated for analysis]

#### Page 405

Solution. We first evaluate the loss tangent, using the given data:
$$
\frac{\sigma}{\omega\epsilon^{\prime}}=\frac{4}{(2\pi\times 10^{6})(81)(8.85\times 10^{-12})}=8.9\times 10^{2}\gg 1
$$
Seawater is therefore a good conductor at 1 MHz (and at frequencies lower than this). The skin depth is
$$
\delta=\frac{1}{\sqrt{\pi f\mu\sigma}}=\frac{1}{\sqrt{(\pi\times 10^{6})(4\pi\times 10^{-7})}(4)}=0.25~{}~{}\mathrm{m}=25~{}~{}\mathrm{cm}
$$
 Now
$$
\lambda=2\pi\delta=1.6\mathrm{~m}
$$
 and
$$
v_{p}=\omega\delta=\left(2\pi\times 10^{6}\right)\left(0.25\right)=1.6\times 10^{6}~{}\mathrm{m/s}
$$
 In free space, these values would have been $\lambda=300$ m and of course $v=c$.

With a 25-cm skin depth, it is obvious that radio frequency communication in seawater is quite impractical. Notice, however, that $\delta$ varies as $1/\sqrt{f}$, so that things will improve at lower frequencies. For example, if we use a frequency of 10 Hz (in the ELF, or extremely low frequency range), the skin depth is increased over that at 1 MHz by a factor of $\sqrt{10^{6}/10}$, so that
$$
\delta(10~{}\mathrm{Hz})\doteq 80\mathrm{~m}
$$
 The corresponding wavelength is $ \lambda=2\pi\delta\dot

[Truncated for analysis]

## Core Ideas

- Salt ions make seawater conductive.
- At 1 MHz, seawater has $\sigma=4\ \mathrm{S/m}$ and $\epsilon'_r=81$.
- Its loss tangent is $8.9\times10^2$, so the good-conductor approximation applies.
- The 1 MHz skin depth is $0.25\ \mathrm{m}$.
- The conductor wavelength is $1.6\ \mathrm{m}$.
- The phase velocity is $1.6\times10^6\ \mathrm{m/s}$.
- At 10 Hz, the skin depth increases to approximately $80\ \mathrm{m}$.
- ELF communication gains penetration but suffers very low data rates and enormous antenna requirements.

## Source Anchors

- Example 11.6 attributes seawater conductivity to mobile sodium and chloride ions.
- The loss-tangent calculation gives $8.9\times10^2\gg1$ at 1 MHz.
- The skin-depth calculation gives $\delta=0.25\ \mathrm{m}$.
- The source obtains $\lambda=1.6\ \mathrm{m}$ and $v_p=1.6\times10^6\ \mathrm{m/s}$.
- At 10 Hz, the source estimates $\delta\doteq80\ \mathrm{m}$ and $\lambda\doteq500\ \mathrm{m}$.
- The source notes that an ELF word can take several minutes to transmit.

## Related Pages

- [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
- [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
- [[conductivity-as-imaginary-permittivity|Conductivity as Imaginary Permittivity]]

## Concept Dependencies

- example-of: [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
- applies-to: [[skin-depth-and-field-confinement|Skin Depth and Field Confinement]]
