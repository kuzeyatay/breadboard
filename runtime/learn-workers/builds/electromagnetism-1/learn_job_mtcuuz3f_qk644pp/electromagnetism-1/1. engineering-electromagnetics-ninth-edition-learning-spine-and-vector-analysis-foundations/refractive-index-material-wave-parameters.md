---
title: "1.255 Refractive Index and Material Wave Parameters"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 436", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers"]
related: ["half-wave-matching", "fabry-perot-resonance-free-spectral-range", "quarter-wave-matching-antireflection-coatings", "wavevector-representation-general-plane-waves", "phase-matching-reflection-law-snells-law"]
---

# 1.255 Refractive Index and Material Wave Parameters

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 436, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers

For a lossless, nonmagnetic dielectric, the refractive index provides a compact way to express the medium's electromagnetic wave properties. It is defined by $n=\sqrt{\epsilon_r}$. This notation is especially common at optical frequencies, while relative permittivity is more traditionally quoted at lower frequencies. The source restricts the index formulas to media with no dielectric loss and with $\mu_r=1$, because a lossy medium would generally have a complex relative permittivity and therefore a complex refractive index. Substituting $n$ into the plane-wave relations gives the phase constant $\beta=k=n\omega/c$ and the intrinsic impedance $\eta=\eta_0/n$. Increasing index therefore increases phase accumulation per unit distance while reducing intrinsic impedance. It also reduces phase velocity to $v_p=c/n$ and shortens wavelength to $\lambda=\lambda_0/n$. These linked formulas are central to the later matching, refraction, Fabry-Perot, and dispersion calculations. The notation $n$ must not be confused with the Greek symbol $\eta$, since one is dimensionless refractive index and the other is impedance measured in ohms.

## Page-Grounded Details

#### Page 436

the results on reflection and transmission. Equivalently, we have a single-interface problem involving $\eta_{1}$ and $\eta_{3}$. Now, with $\eta_{3} = \eta_{1}$, we have a matched input impedance, and there is no net reflected wave. This method of choosing the region 2 thickness is known as half-wave matching. Its applications include, for example, antenna housings on airplanes known as radomes, which form a part of the fuselage. The antenna, inside the aircraft, can transmit and receive through this layer, which can be shaped to enable good aerodynamic characteristics. Note that the half-wave matching condition no longer applies as we deviate from the wavelength that satisfies it. When this is done, the device reflectivity increases (with increased wavelength deviation), so it ultimately acts as a bandpass filter.

Often, it is convenient to express the dielectric constant of the medium through the refractive index (or just index), n, defined as
$$
n = \sqrt{\epsilon_{r}}\quad{(38)}
$$
Characterizing materials by their refractive indices is primarily done at optical frequencies (on the order of $10^{14}$ Hz), whereas at much lower frequencies, a dielectric constant is t

[Truncated for analysis]

## Core Ideas

- The lossless-dielectric refractive index is $n=\sqrt{\epsilon_r}$.
- The phase constant is $\beta=k=n\omega/c$.
- The intrinsic impedance is $\eta=\eta_0/n$.
- The phase velocity is $v_p=c/n$.
- The material wavelength is $\lambda=\lambda_0/n$.
- The stated formulas assume a lossless medium with $\mu_r=1$.
- Refractive index $n$ and intrinsic impedance $\eta$ represent different physical quantities.

## Source Anchors

- Equation (38) defines $n=\sqrt{\epsilon_r}$.
- Equation (39) gives
$$
\beta=k=\omega\sqrt{\mu_0\epsilon_0}\sqrt{\epsilon_r}=\frac{n\omega}{c}
$$
- Equation (40) gives
$$
\eta=\frac{\eta_0}{n}
$$
- Equation (41) gives $v_p=c/n$.
- Equation (42) gives $\lambda=\lambda_0/n$.
- Page 436 explicitly warns against confusing $n$ with $\eta$.

## Related Pages

- [[half-wave-matching|Half-Wave Matching]]
- [[fabry-perot-resonance-free-spectral-range|Fabry-Perot Resonance and Free Spectral Range]]
- [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]
- [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]

## Concept Dependencies

- applies-to: [[half-wave-matching|Half-Wave Matching]]
- applies-to: [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]
