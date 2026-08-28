---
title: "1.230 Skin Depth and Field Confinement"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 403", "Page 404"]
related: ["good-conductor-propagation-approximation", "seawater-propagation-and-elf-communication", "good-conductor-intrinsic-impedance-and-power-density", "skin-effect-resistance"]
---

# 1.230 Skin Depth and Field Confinement

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 403, Page 404

The skin depth $\delta$ is the distance into a good conductor at which electric-field and current-density amplitudes fall to $e^{-1}=0.368$ of their surface values. Since $\alpha=\beta=\sqrt{\pi f\mu\sigma}$, it is given by $\delta=1/\sqrt{\pi f\mu\sigma}=1/\alpha=1/\beta$. Power density contains the squared field attenuation and therefore falls to $e^{-2}=0.135$ of its surface value after one skin depth. For copper, the source gives $\delta_{\mathrm{Cu}}=0.066/\sqrt{f}$ with frequency in hertz, producing $8.53\ \mathrm{mm}$ at 60 Hz and $6.61\times10^{-4}\ \mathrm{mm}$ at 10,000 MHz. At high frequencies, fields are essentially zero more than a few skin depths below the surface. Electromagnetic energy therefore travels primarily in the space surrounding a good conductor, while the conductor guides the wave. The practical consequences include hollow high-current conductors at power frequencies and thin conductive coatings at microwave frequencies. Within a good conductor, wavelength and phase velocity are related directly to skin depth by $\lambda=2\pi\delta$ and $v_p=\omega\delta$.

## Page-Grounded Details

#### Page 403

We may tie this field in the conductor to an external field at the conductor surface. We let the region $z>0$ be the good conductor and the region $z<0$ be a perfect dielectric. At the boundary surface $z=0$, (80) becomes
$$
E_{x}=E_{x0} \operatorname{cosev}{\omega t} \qquad(z=0)
$$
We consider this to be the source field that establishes the fields within the conductor. Since displacement current is negligible,
$$
\mathbf{J}=\sigma\mathbf{E}
$$
Thus, the conduction current density at any point within the conductor is directly related to $\mathbf{E}$:
$$
J_{x}=\sigma E_{x}=\sigma E_{x0} e^{-z\sqrt{\pi f\mu\sigma}} \operatorname{cosev}(\omega t-z\sqrt{\pi f\mu\sigma}) \quad{(81)}
$$
#### 11.4.2 Skin Effect

Equations (80) and (81) contain a wealth of information. Considering first the negative exponential term, we find an exponential decrease in the conduction current density and electric field intensity with penetration into the conductor (away from the source). The exponential factor is unity at $z=0$ and decreases to $e^{-1}=0.368$ when
$$
z=\frac{1}{\sqrt{\pi f\mu\sigma}}
$$
This distance is denoted by $\delta$ and is termed the depth of penetration, or the

[Truncated for analysis]

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

## Core Ideas

- Skin depth is $\delta=1/\sqrt{\pi f\mu\sigma}$.
- It equals both $1/\alpha$ and $1/\beta$ for a good conductor.
- Field amplitude falls to $e^{-1}$ after one skin depth.
- Power density falls to $e^{-2}=0.135$ after one skin depth.
- Skin depth decreases with the square root of frequency, permeability, and conductivity.
- Fields are negligible beyond a few skin depths in a good conductor.
- The conductor wavelength is $\lambda=2\pi\delta$.
- The conductor phase velocity is $v_p=\omega\delta$.

## Source Anchors

- Equation (82) defines $\delta=1/\sqrt{\pi f\mu\sigma}=1/\alpha=1/\beta$.
- The copper relation is given as $\delta_{\mathrm{Cu}}=0.066/\sqrt{f}$.
- Copper skin depth is $8.53\ \mathrm{mm}$ at 60 Hz and $6.61\times10^{-4}\ \mathrm{mm}$ at 10,000 MHz.
- The source states that fields are essentially zero at distances greater than a few skin depths.
- Equation (83) gives $\lambda=2\pi\delta$.
- Equation (84) gives $v_p=\omega\delta$.
- For copper at 60 Hz, the source gives $\lambda=5.36\ \mathrm{cm}$ and $v_p=3.22\ \mathrm{m/s}$.

## Related Pages

- [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
- [[seawater-propagation-and-elf-communication|Seawater Propagation and ELF Communication]]
- [[good-conductor-intrinsic-impedance-and-power-density|Good-Conductor Intrinsic Impedance and Power Density]]
- [[skin-effect-resistance|Skin-Effect Resistance]]

## Concept Dependencies

- derives-from: [[good-conductor-propagation-approximation|Good-Conductor Propagation Approximation]]
