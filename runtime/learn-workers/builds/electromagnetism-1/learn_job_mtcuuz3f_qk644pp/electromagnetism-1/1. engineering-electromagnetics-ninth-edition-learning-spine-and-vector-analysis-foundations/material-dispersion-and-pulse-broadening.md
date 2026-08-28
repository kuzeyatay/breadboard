---
title: "1.359 Material Dispersion and Pulse Broadening"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 587, discussion following Figure E.2 and Equation (E.22)"]
related: ["time-harmonic-polarization-waves", "resonant-susceptibility-and-complex-permittivity", "near-resonance-absorption-line-shape"]
---

# 1.359 Material Dispersion and Pulse Broadening

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 587, discussion following Figure E.2 and Equation (E.22)

Away from a strong absorption peak, the imaginary susceptibility may be small while the real susceptibility still changes significantly with frequency. Under this low-loss condition, the refractive index is approximated by
$$
n\doteq\sqrt{1+\chi_{\mathrm{res}}'}
$$
 Because $\chi_{\mathrm{res}}'$ depends on frequency, the refractive index also depends on frequency. The phase velocity therefore varies across the spectral components of a signal. The group velocity, which characterizes the motion of a pulse envelope, likewise becomes frequency-dependent. A finite-duration pulse contains a range of frequencies, so those components travel at different velocities and cease to remain aligned. The result is group dispersion and temporal pulse broadening. The source explicitly traces this macroscopic signal distortion back to microscopic material resonances. This connection distinguishes dispersive behavior from absorption: a medium can be nearly transparent at an operating frequency and still distort a broadband pulse because the slope of its real susceptibility remains appreciable.

## Page-Grounded Details

#### Page 587

Figure E.2 Plots of the real and imaginary parts of the resonant susceptibility, $\chi_{\rm res}$, as given by Eq. (E.20). The full-width at half-maximum of the imaginary part, $\chi_{\rm res}^{\prime}$, is equal to the damping coefficient, $\gamma_{d}$.

Key features to note in Figure E.2 include the symmetric $\chi_{e}^{\prime\prime}$ function, whose full width at its half-maximum amplitude is $\gamma_{d}$. Near the resonant frequency, where $\chi_{\rm res}^{\prime\prime}$ maximizes, wave attenuation maximizes as seen from Eq. (44), Chapter 11. Additionally, we see that away from resonance, attenuation is relatively weak, and the material becomes transparent. As Figure E.2 shows, there is still significant variation of $\chi_{\rm res}^{\prime}$ with frequency away from resonance, which leads to a frequency-dependent refractive index; this is expressed approximately as
$$
n\doteq\sqrt{1+\chi_{\rm res}^{\prime}}\quad(away\ from\ resonance)\quad(E.22)
$$
This frequency-dependent $n$, arising from the material resonance, leads to phase and group velocities that also depend on frequency. Thus, group dispersion, leading to pulse-broadening effects as discussed in Chap

[Truncated for analysis]

## Core Ideas

- Away from resonance, $n\doteq\sqrt{1+\chi_{\mathrm{res}}'}$.
- Frequency-dependent real susceptibility produces a frequency-dependent refractive index.
- A frequency-dependent refractive index changes phase velocity.
- Group velocity also varies with frequency in a dispersive material.
- Different pulse-frequency components accumulate different delays.
- Material resonance can therefore cause pulse broadening even where attenuation is weak.

## Source Anchors

- Equation (E.22):
$$
n\doteq\sqrt{1+\chi_{\mathrm{res}}'}\quad\text{away from resonance}
$$
- Page 587 states that significant variation of $\chi_{\mathrm{res}}'$ persists away from resonance.
- The source links frequency-dependent refractive index to frequency-dependent phase and group velocities.
- Group dispersion and pulse broadening are explicitly attributed to material resonances.

## Related Pages

- [[time-harmonic-polarization-waves|Time-Harmonic Polarization Waves]]
- [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- [[near-resonance-absorption-line-shape|Near-Resonance Absorption Line Shape]]

## Concept Dependencies

- derives-from: [[resonant-susceptibility-and-complex-permittivity|Resonant Susceptibility and Complex Permittivity]]
- related: [[near-resonance-absorption-line-shape|Near-Resonance Absorption Line Shape]]
