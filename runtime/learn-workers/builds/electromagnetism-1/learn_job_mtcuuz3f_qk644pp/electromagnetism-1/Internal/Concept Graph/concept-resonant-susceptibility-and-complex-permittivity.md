---
title: "Resonant Susceptibility and Complex Permittivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "resonant-susceptibility-and-complex-permittivity"
locations: ["Page 586, Equations (E.15) through (E.19)"]
related: ["electric-susceptibility-and-relative-permittivity", "driven-oscillator-equation-and-phasor-solution", "near-resonance-absorption-line-shape", "material-dispersion-and-pulse-broadening"]
---

## ConceptNode: Resonant Susceptibility and Complex Permittivity

Planning node for [[resonant-susceptibility-and-complex-permittivity|1.357 Resonant Susceptibility and Complex Permittivity]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 586, Equations (E.15) through (E.19)

The oscillator displacement becomes a macroscopic dielectric response through two substitutions. First, the phasor dipole moment is $p_s=-ed_s$. Second, if all dipoles are identical and their number density is $N$, the polarization is $P_s=Np_s$. Substitution of the phasor displacement gives $$P_s=\frac{Ne^2/m}{(\omega_0^2-\omega^2)+j\omega\gamma_d}E_s.$$ Comparing this result with $P_s=\epsilon_0\chi E_s$ identifies the resonant susceptibility: $$\chi_{\mathrm{res}}=\frac{Ne^2}{\epsilon_0m}\frac{1}{(\omega_0^2-\omega^2)+j\omega\gamma_d}.$$ With the convention $\chi_{\mathrm{res}}=\chi_{\mathrm{res}}'-j\chi_{\mathrm{res}}''$, the complex permittivity is $\epsilon=\epsilon'-j\epsilon''$, where $$\epsilon'=\epsilon_0(1+\chi_{\mathrm{res}}')$$ and $$\epsilon''=\epsilon_0\chi_{\mathrm{res}}''.$$ The real component changes phase propagation and refractive index, while the imaginary component produces dielectric absorption and attenuation. These quantities can be inserted into the lossy-medium propagation formulas for attenuation coefficient $\alpha$ and phase constant $\beta$.

### Key planning details

- The dipole phasor is $p_s=-ed_s$.
- For identical dipoles, polarization is $P_s=Np_s$.
- Resonant susceptibility follows by comparing polarization with $P_s=\epsilon_0\chi E_s$.
- The susceptibility denominator contains detuning and damping.
- $\epsilon'$ is determined by the real susceptibility.
- $\epsilon''$ is determined by the imaginary susceptibility.
- Complex permittivity controls attenuation and phase propagation.

### Source coverage

- Equation (E.15): $$p_s=-ed_s.$$
- Equation (E.16): $$P_s=\frac{Ne^2/m}{(\omega_0^2-\omega^2)+j\omega\gamma_d}E_s.$$
- Equation (E.17): $$\chi_{\mathrm{res}}=\frac{Ne^2}{\epsilon_0m}\frac{1}{(\omega_0^2-\omega^2)+j\omega\gamma_d}.$$
- Equation (E.18): $$\epsilon'=\epsilon_0(1+\chi_{\mathrm{res}}').$$
- Equation (E.19): $$\epsilon''=\epsilon_0\chi_{\mathrm{res}}''.$$
- The source connects $\epsilon'$ and $\epsilon''$ to the plane-wave attenuation coefficient $\alpha$ and phase constant $\beta$.
