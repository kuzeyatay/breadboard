---
title: "1.352 Electric Susceptibility and Relative Permittivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 583, Section: Origins of the Complex Permittivity", "Page 584, opening discussion", "Page 586, Equations (E.17) through (E.19)"]
related: ["microscopic-dipoles-and-macroscopic-polarization", "resonant-susceptibility-and-complex-permittivity", "additive-susceptibility-of-multi-mechanism-materials"]
---

# 1.352 Electric Susceptibility and Relative Permittivity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 583, Section: Origins of the Complex Permittivity, Page 584, opening discussion, Page 586, Equations (E.17) through (E.19)

For a linear dielectric, the applied electric field and the resulting polarization are related through the electric susceptibility $\chi_e$. The constitutive relation is
$$
\mathbf{P}=\epsilon_0\chi_e\mathbf{E}
$$
 where $\epsilon_0$ is the permittivity of free space, $\mathbf{E}$ is the electric field, and $\mathbf{P}$ is the polarization density. The relative permittivity is then
$$
\epsilon_r=1+\chi_e
$$
 The additive term 1 represents the free-space contribution, while $\chi_e$ captures the material contribution caused by polarization. Consequently, understanding why permittivity varies with frequency requires understanding how the material polarization responds to a time-varying field. When polarization does not follow the field instantaneously, susceptibility becomes complex. Its real part describes the in-phase, energy-storing and dispersive response, while its imaginary part describes the out-of-phase, absorptive response. This relationship provides the bridge from microscopic dipole dynamics to macroscopic wave quantities such as attenuation, phase constant, refractive index, phase velocity, and group velocity.

## Page-Grounded Details

#### Page 583

### Origins of the Complex Permittivity

As we learned in Chapter 5, a dielectric can be modeled as an arrangement of atoms and molecules in free space, which can be polarized by an electric field. The field forces positive and negative bound charges to separate against their Coulomb attractive forces, thus producing an array of microscopic dipoles. The molecules can be arranged in an ordered and predictable manner (such as in a crystal) or may exhibit random positioning and orientation, as would occur in an amorphous material or a liquid. The molecules may or may not exhibit permanent dipole moments (existing before the field is applied), and if they do, they will usually have random orientations throughout the material volume. As discussed in Section 5.7, the displacement of charges in a regular manner, as induced by an electric field, gives rise to a macroscopic polarization, $\mathbf{P}$, defined as the dipole moment per unit volume:
$$
\mathbf{P}=\operatorname*{lim}_{\Delta\mathbf{v}\to 0}\frac{1}{\Delta\mathbf{v}}\sum_{i=1}^{N\Delta\mathbf{v}}\mathbf{p}_{i}\quad{(E.1)}
$$
where $N$ is the number of dipoles per unit volume and $\mathbf{p}_{i}$ is the dipole moment of t

[Truncated for analysis]

#### Page 584

Therefore, to understand the nature of $\epsilon_{r}$, we need to understand $\chi_{e}$, which in turn means that we need to explore the behavior of the polarization, $\mathbf{P}$.

Here, we consider the added complications of how the dipoles respond to a time-harmonic field that propagates as a wave through the material. The result of applying such a forcing function is that oscillating dipole moments are set up, and these in turn establish a polarization wave that propagates through the material. The effect is to produce a polarization function, $\mathbf{P}(z,t)$, having the same functional form as the driving field, $\mathbf{E}(z,t)$. The molecules themselves do not move through the material, but their oscillating dipole moments collectively exhibit wave motion, just as waves in pools of water are formed by the up-and-down motion of the water. From here, the description of the process gets complicated and in many ways beyond the scope of our present discussion. We can form a basic qualitative understanding, however, by considering the classical description of the process, which is that the dipoles, once oscillating, behave as microscopic antennas, re-radiating fields t

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

- Linear polarization obeys $\mathbf{P}=\epsilon_0\chi_e\mathbf{E}$.
- $\epsilon_0$ is the free-space permittivity.
- $\chi_e$ represents the material contribution to the dielectric response.
- Relative permittivity satisfies $\epsilon_r=1+\chi_e$.
- A frequency-dependent polarization produces a frequency-dependent susceptibility.
- Complex susceptibility separates dispersive and absorptive behavior.

## Source Anchors

- Equation (E.3):
$$
\mathbf{P}=\epsilon_0\chi_e\mathbf{E}
$$
- Equation (E.4):
$$
\epsilon_r=1+\chi_e
$$
- Page 584 states that understanding $\epsilon_r$ requires understanding $\chi_e$, which requires exploring $\mathbf{P}$.
- Pages 586 and 589 explicitly divide complex susceptibility into real and imaginary response components.

## Related Pages

- [[microscopic-dipoles-and-macroscopic-polarization|Microscopic Dipoles and Macroscopic Polarization]]
- [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- [[additive-susceptibility-of-multi-mechanism-materials|Additive Susceptibility of Multi-Mechanism Materials]]

