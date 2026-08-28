---
title: "1.358 Near-Resonance Absorption Line Shape"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 586, Equations (E.20) and (E.21)", "Page 587, Figure E.2 and its interpretation"]
related: ["damping-and-dephasing-of-bound-electrons", "resonant-susceptibility-and-complex-permittivity", "material-dispersion-and-pulse-broadening"]
---

# 1.358 Near-Resonance Absorption Line Shape

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 586, Equations (E.20) and (E.21), Page 587, Figure E.2 and its interpretation

Near the natural frequency, the Lorentz susceptibility can be written in terms of a normalized detuning parameter. The source defines
$$
\delta_n=\frac{2}{\gamma_d}(\omega-\omega_0)
$$
 which measures the frequency offset from resonance relative to the damping-controlled linewidth. The approximate susceptibility is
$$
\chi_{\mathrm{res}}\doteq-\frac{Ne^2}{\epsilon_0m\omega_0\gamma_d}\left(\frac{j+\delta_n}{1+\delta_n^2}\right)
$$
 Figure E.2 separates this expression into its real and imaginary components. The imaginary component is symmetric around $\omega_0$, reaches its maximum at resonance, and has a full width at half maximum equal to $\gamma_d$. Because the imaginary permittivity governs dielectric loss, wave attenuation is greatest near the resonant frequency. Farther from resonance, the imaginary component becomes small, attenuation weakens, and the material becomes comparatively transparent. The real component changes sign across resonance and varies substantially even where absorption is weak, so a material can exhibit strong dispersion without strong attenuation.

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

#### Page 587

Figure E.2 Plots of the real and imaginary parts of the resonant susceptibility, $\chi_{\rm res}$, as given by Eq. (E.20). The full-width at half-maximum of the imaginary part, $\chi_{\rm res}^{\prime}$, is equal to the damping coefficient, $\gamma_{d}$.

Key features to note in Figure E.2 include the symmetric $\chi_{e}^{\prime\prime}$ function, whose full width at its half-maximum amplitude is $\gamma_{d}$. Near the resonant frequency, where $\chi_{\rm res}^{\prime\prime}$ maximizes, wave attenuation maximizes as seen from Eq. (44), Chapter 11. Additionally, we see that away from resonance, attenuation is relatively weak, and the material becomes transparent. As Figure E.2 shows, there is still significant variation of $\chi_{\rm res}^{\prime}$ with frequency away from resonance, which leads to a frequency-dependent refractive index; this is expressed approximately as
$$
n\doteq\sqrt{1+\chi_{\rm res}^{\prime}}\quad(away\ from\ resonance)\quad(E.22)
$$
This frequency-dependent $n$, arising from the material resonance, leads to phase and group velocities that also depend on frequency. Thus, group dispersion, leading to pulse-broadening effects as discussed in Chap

[Truncated for analysis]

## Core Ideas

- Normalized detuning is $\delta_n=2(\omega-\omega_0)/\gamma_d$.
- The near-resonance susceptibility has a Lorentzian denominator $1+\delta_n^2$.
- The imaginary susceptibility is symmetric about resonance.
- Its full width at half maximum is $\gamma_d$.
- Attenuation is greatest where the imaginary susceptibility is largest.
- The material becomes relatively transparent away from resonance.
- The real susceptibility can remain strongly frequency-dependent outside the absorption peak.

## Source Anchors

- Equation (E.20):
$$
\chi_{\mathrm{res}}\doteq-\frac{Ne^2}{\epsilon_0m\omega_0\gamma_d}\left(\frac{j+\delta_n}{1+\delta_n^2}\right)
$$
- Equation (E.21):
$$
\delta_n=\frac{2}{\gamma_d}(\omega-\omega_0)
$$
- Source figure S1.P587.F1, Figure E.2, plots the real and imaginary components of resonant susceptibility against frequency.
- The text identifies the imaginary-part full width at half maximum as $\gamma_d$.
- The source states that attenuation maximizes near the resonant frequency and is relatively weak away from resonance.

## Related Pages

- [[damping-and-dephasing-of-bound-electrons|Damping and Dephasing of Bound Electrons]]
- [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- [[material-dispersion-and-pulse-broadening|Material Dispersion and Pulse Broadening]]

## Concept Dependencies

- part-of: [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- measured-by: [[damping-and-dephasing-of-bound-electrons|Damping and Dephasing of Bound Electrons]]
