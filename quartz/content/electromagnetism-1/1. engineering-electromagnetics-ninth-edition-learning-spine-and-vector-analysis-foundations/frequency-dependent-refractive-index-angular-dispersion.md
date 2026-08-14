---
title: "1.265 Frequency-Dependent Refractive Index and Angular Dispersion"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 452", "Page 453", "Page 454", "Section 12.7: Wave Propagation in Dispersive Media"]
related: ["refractive-index-material-wave-parameters", "phase-matching-reflection-law-snells-law", "wavevector-representation-general-plane-waves", "dispersion-relation-phase-velocity-group-velocity"]
---

# 1.265 Frequency-Dependent Refractive Index and Angular Dispersion

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 452, Page 453, Page 454, Section 12.7: Wave Propagation in Dispersive Media

Material permittivity generally depends on frequency because bound charges respond as driven harmonic oscillators with resonant frequencies. Near resonance, strong charge motion increases absorption and changes both the real and imaginary parts of permittivity. Significant refractive-index variation can also occur sufficiently far from resonance that absorption is negligible, allowing a medium to be treated as approximately lossless while still being dispersive. A glass prism illustrates this effect: different optical frequencies experience different refractive indices, so Snell's law sends different colors in different directions. This spatial separation is chromatic angular dispersion. The source emphasizes that the prism disperses spectral power, not merely abstract frequencies. A narrow-aperture detector can isolate and measure a small spectral packet at a selected output angle. Reducing the aperture width narrows the detected spectral interval and improves wavelength resolution. Figure 12.11 supplies the measurement geometry. This spectral-packet interpretation prepares for temporal dispersion, where different frequency components of a finite-bandwidth wave propagate differently and can change the wave's envelope in time.

## Page-Grounded Details

#### Page 452

Light is incident from air to glass at Brewster's angle. Determine the incident and transmitted angles.

Solution. Because glass has refractive index $n_{2}=1.45$, the incident angle will be
$$
\theta_{1}=\theta_{B}=\sin^{-1}\left(\frac{n_{2}}{\sqrt{n_{1}^{2}+n_{2}^{2}}}\right)=\sin^{-1}\left(\frac{1.45}{\sqrt{1.45^{2}+1}}\right)=55.4^{\circ}
$$
The transmitted angle is found from Snell's law, through
$$
\theta_{2}=\sin^{-1}\left(\frac{n_{1}}{n_{2}}\sin\theta_{B}\right)=\sin^{-1}\left(\frac{n_{1}}{\sqrt{n_{1}^{2}+n_{2}^{2}}}\right)=34.6^{\circ}
$$
Note from this exercise that $\sin\theta_{2}=\cos\theta_{B}$, which means that the sum of the incident and refracted angles at the Brewster condition is always $90^{\circ}$.

Many of the results we have seen in this section are summarized in Figure 12.10, in which $\Gamma_{p}$ and $\Gamma_{s}$, from (69) and (71), are plotted as functions of the incident angle, $\theta_{1}$. Curves are shown for selected values of the refractive index ratio, $n_{1}/n_{2}$. For all plots in which $n_{1}/n_{2}>1$, $\Gamma_{s}$ and $\Gamma_{p}$ achieve values of $\pm 1$ at the critical angle. At larger angles, the reflection coeffic

[Truncated for analysis]

#### Page 453

Figure 12.10 (a) Plots of $\Gamma_{p}$ [Eq. (69)] as functions of the incident angle, $\theta_{1}$, as shown in Figure 12.7a. Curves are shown for selected values of the refractive index ratio, $n_{1}/n_{2}$. Both media are lossless and have $\mu_{r}=1$. Thus $\eta_{1}=\eta_{0}/n_{1}$ and $\eta_{2}=\eta_{0}/n_{2}$. (b) Plots of $\Gamma_{s}$ [Eq. (71)] as functions of the incident angle, $\theta_{1}$, as shown in Figure 12.7b. As in Figure 12.10a, the media are lossless, and curves are shown for selected $n_{1}/n_{2}$.

#### Page 454

Figure 12.11 The angular dispersion of a prism can be measured using a movable device which measures both wavelength and power. The device senses light through a small aperture, thus improving wavelength resolution.

the dielectric constant will be different at frequencies near resonance than at frequencies far from resonance. In short, resonance effects give rise to values of $\epsilon^{\prime}$ and $\epsilon^{\prime\prime}$ that will vary continuously with frequency. These in turn will produce a fairly complicated frequency dependence in the attenuation and phase constants as expressed in Eqs. (44) and (45) in Chapter 11.

This section concerns the effect of a frequency-varying dielectric constant (or refractive index) on a wave as it propagates in an otherwise lossless medium. This situation arises quite often because significant refractive index variation can occur at frequencies far away from resonance, where absorptive losses are negligible. A classic example of this is the separation of white light into its component colors by a glass prism. In this case, the frequency-dependent refractive index results in different angles of refraction for the different colors-hence the

[Truncated for analysis]

## Core Ideas

- Bound-charge resonances make complex permittivity frequency dependent.
- Near resonance, absorption and dielectric response change strongly.
- A medium may show appreciable index variation where absorption is still negligible.
- A prism separates colors because refractive index depends on frequency.
- Spatial color separation is chromatic angular dispersion.
- A narrow detector aperture selects a narrow spectral power packet.
- Smaller apertures improve wavelength resolution.

## Source Anchors

- Pages 452 and 454 connect bound-charge harmonic resonances to frequency-dependent $\epsilon'$ and $\epsilon''$.
- Page 454 identifies prism color separation as chromatic angular dispersion.
- Figure S1.P454.F1, corresponding to Figure 12.11, shows a movable wavelength-and-power detector with a small aperture.
- The source defines the detected narrow spectral slice as a spectral packet.
- Page 454 states that smaller aperture width produces narrower spectral width and greater measurement precision.
- The discussion explicitly uses spectral packets to prepare for wave dispersion in time.

## Related Pages

- [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
- [[dispersion-relation-phase-velocity-group-velocity|Dispersion Relation, Phase Velocity, and Group Velocity]]

## Concept Dependencies

- depends-on: [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
- applies-to: [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
