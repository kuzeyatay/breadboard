---
title: "1.357 Resonant Susceptibility and Complex Permittivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 586, Equations (E.15) through (E.19)"]
related: ["electric-susceptibility-and-relative-permittivity", "driven-oscillator-equation-and-phasor-solution", "near-resonance-absorption-line-shape", "material-dispersion-and-pulse-broadening"]
---

# 1.357 Resonant Susceptibility and Complex Permittivity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 586, Equations (E.15) through (E.19)

The oscillator displacement becomes a macroscopic dielectric response through two substitutions. First, the phasor dipole moment is $p_s=-ed_s$. Second, if all dipoles are identical and their number density is $N$, the polarization is $P_s=Np_s$. Substitution of the phasor displacement gives
$$
P_s=\frac{Ne^2/m}{(\omega_0^2-\omega^2)+j\omega\gamma_d}E_s
$$
 Comparing this result with $P_s=\epsilon_0\chi E_s$ identifies the resonant susceptibility:
$$
\chi_{\mathrm{res}}=\frac{Ne^2}{\epsilon_0m}\frac{1}{(\omega_0^2-\omega^2)+j\omega\gamma_d}
$$
 With the convention $\chi_{\mathrm{res}}=\chi_{\mathrm{res}}'-j\chi_{\mathrm{res}}''$, the complex permittivity is $\epsilon=\epsilon'-j\epsilon''$, where
$$
\epsilon'=\epsilon_0(1+\chi_{\mathrm{res}}')
$$
 and
$$
\epsilon''=\epsilon_0\chi_{\mathrm{res}}''
$$
 The real component changes phase propagation and refractive index, while the imaginary component produces dielectric absorption and attenuation. These quantities can be inserted into the lossy-medium propagation formulas for attenuation coefficient $\alpha$ and phase constant $\beta$.

## Page-Grounded Details

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

- The dipole phasor is $p_s=-ed_s$.
- For identical dipoles, polarization is $P_s=Np_s$.
- Resonant susceptibility follows by comparing polarization with $P_s=\epsilon_0\chi E_s$.
- The susceptibility denominator contains detuning and damping.
- $\epsilon'$ is determined by the real susceptibility.
- $\epsilon''$ is determined by the imaginary susceptibility.
- Complex permittivity controls attenuation and phase propagation.

## Source Anchors

- Equation (E.15):
$$
p_s=-ed_s
$$
- Equation (E.16):
$$
P_s=\frac{Ne^2/m}{(\omega_0^2-\omega^2)+j\omega\gamma_d}E_s
$$
- Equation (E.17):
$$
\chi_{\mathrm{res}}=\frac{Ne^2}{\epsilon_0m}\frac{1}{(\omega_0^2-\omega^2)+j\omega\gamma_d}
$$
- Equation (E.18):
$$
\epsilon'=\epsilon_0(1+\chi_{\mathrm{res}}')
$$
- Equation (E.19):
$$
\epsilon''=\epsilon_0\chi_{\mathrm{res}}''
$$
- The source connects $\epsilon'$ and $\epsilon''$ to the plane-wave attenuation coefficient $\alpha$ and phase constant $\beta$.

## Related Pages

- [[electric-susceptibility-and-relative-permittivity|Electric Susceptibility and Relative Permittivity]]
- [[driven-oscillator-equation-and-phasor-solution|Driven-Oscillator Equation and Phasor Solution]]
- [[near-resonance-absorption-line-shape|Near-Resonance Absorption Line Shape]]
- [[material-dispersion-and-pulse-broadening|Material Dispersion and Pulse Broadening]]

## Concept Dependencies

- derives-from: [[driven-oscillator-equation-and-phasor-solution|Driven-Oscillator Equation and Phasor Solution]]
- applies-to: [[electric-susceptibility-and-relative-permittivity|Electric Susceptibility and Relative Permittivity]]
