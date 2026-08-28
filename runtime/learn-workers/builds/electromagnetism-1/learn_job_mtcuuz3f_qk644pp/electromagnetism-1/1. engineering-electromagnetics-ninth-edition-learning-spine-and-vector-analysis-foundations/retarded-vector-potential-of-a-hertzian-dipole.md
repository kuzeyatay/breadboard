---
title: "1.307 Retarded Vector Potential of a Hertzian Dipole"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 528", "Page 529", "Section 14.1.1", "Figure 14.2"]
related: ["radiation-from-time-varying-currents-and-the-hertzian-dipole-model", "general-electromagnetic-fields-of-a-hertzian-dipole", "near-field-and-far-field-behavior"]
---

# 1.307 Retarded Vector Potential of a Hertzian Dipole

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 528, Page 529, Section 14.1.1, Figure 14.2

The retarded vector magnetic potential accounts for the finite propagation time between a current source and an observation point. For a general filamentary current, the source contribution is evaluated at the retarded time $t-R/v$, where $R$ is source-to-observer distance and $v=1/\sqrt{\mu\epsilon}$ is the phase velocity in the surrounding lossless medium. Because the Hertzian filament is differential and carries uniform current, no spatial integration is required. Its vector potential points along $z$ and decreases as $1/R$. For sinusoidal excitation, the retarded current becomes $I_0\cos(\omega t-kR)$, where $k=\omega/v=\omega\sqrt{\mu\epsilon}$. In phasor form, propagation delay appears as $e^{-jkR}$. The resulting potential is then resolved into spherical components because the subsequent curl operation is most naturally evaluated in spherical coordinates. Projection of $\mathbf{a}_z$ gives a radial component proportional to $\cos\theta$ and a polar component proportional to $-\sin\theta$. This coordinate decomposition provides the direct starting point for deriving the magnetic and electric fields.

## Page-Grounded Details

#### Page 528

Figure 14.1 A differential current filament of length d carries a current $I=I_{0}\cos\omega t$.

permittivity $\epsilon$ (both real). The filament is specified as having a differential length, but we will later extend the results easily to larger dimensions that are on the order of a wavelength. The filament is positioned with its center at the origin and is oriented along the $z$ axis as shown in Figure 14.1. The positive sense of the current is taken in the $\mathbf{a}_{z}$ direction. A uniform current $I(t)=I_{0}\cos\omega t$ is assumed to flow in this short length $d$. The existence of such a current would imply the existence of time-varying charges of equal and opposite instantaneous amplitude on each end of the wire. For this reason, the wire is termed an $elemental$ or $Hertzian$ dipole. This is distinct in meaning from the more general definition of a dipole antenna that we will use later in this chapter.

#### 14.1.1 Retarded Vector Potential for the Hertzian Dipole

The first step is the application of the retarded vector magnetic potential expression, as presented in Section 9.5,
$$
A=\int\frac{\mu\,I[t-R/v]d\mathbf{L}}{4\pi\,R}\quad{(1)}
$$
where $ I

[Truncated for analysis]

#### Page 529

where the wavenumber in the lossless medium is $k = \omega/v = \omega\sqrt{\mu\epsilon}$. In phasor form, Eq. (3) becomes
$$
I_{s} = I_{0}~{}e^{-jkR}
$$
(4)

where the current amplitude, $I_{0}$, is assumed to be real (as it will be throughout this chapter). Incorporating (4) into (2), we find the phasor retarded potential:
$$
A_{s} = A_{zs} \, a_{z} = \frac{\mu I_{0} d}{4\pi R} e^{-jkR} a_{z}
$$
(5)

Using a mixed coordinate system for the moment, we now replace $R$ with the small $r$ of the spherical coordinate system and then determine which spherical components are represented by $A_{zs}$. Using the projections as illustrated in Figure 14.2, we find
$$
A_{rs} = A_{zs} \cos\theta
$$
(6a)
$$
A_{\theta s} = -A_{zs} \sin\theta
$$
(6b)

and therefore
$$
A_{rs} = \frac{\mu I_{0} d}{4\pi r} \cos\theta~{}e^{-jkr}
$$
(7a)
$$
A_{\theta s} = -\frac{\mu I_{0} d}{4\pi r} \sin\theta~{}e^{-jkr}
$$
(7b)

#### 14.1.2 Obtaining the General Electric and Magnetic Fields

From the preceding two components of the vector magnetic potential at $P$ we can now find $\mathbf{B}_{s}$ or $\mathbf{H}_{s}$ from the definition of $\mathbf{A}_{s}$,
$$
\mathbf{B}_{s} = \mu\mathbf{

[Truncated for analysis]

## Core Ideas

- Retarded time is $t-R/v$.
- The phase velocity is $v=1/\sqrt{\mu\epsilon}$.
- The medium wavenumber is $k=\omega/v=\omega\sqrt{\mu\epsilon}$.
- The outgoing-wave phase factor is $e^{-jkr}$.
- The Hertzian-dipole potential has only a $z$ component before coordinate conversion.
- The potential amplitude decreases as $1/r$.
- Projection gives radial and polar spherical components.
- The spherical components are used to calculate $\nabla\times\mathbf{A}_s$.

## Source Anchors

- The general retarded potential is
$$
\mathbf{A}=\int\frac{\mu I[t-R/v]d\mathbf{L}}{4\pi R}.
$$
- For the differential filament
$$
\mathbf{A}=\frac{\mu I[t-R/v]d}{4\pi R}\mathbf{a}_z.
$$
- The retarded current is
$$
I[t-R/v]=I_0\cos(\omega t-kR).
$$
- The phasor potential is
$$
\mathbf{A}_s=\frac{\mu I_0d}{4\pi r}e^{-jkr}\mathbf{a}_z.
$$
- The spherical components are
$$
A_{rs}=\frac{\mu I_0d}{4\pi r}\cos\theta\,e^{-jkr}
$$
and
$$
A_{\theta s}=-\frac{\mu I_0d}{4\pi r}\sin\theta\,e^{-jkr}.$$
- Figure 14.2 depicts the resolution of $A_{zs}$ into $A_{rs}$ and $A_{\theta s}$.

## Related Pages

- [[radiation-from-time-varying-currents-and-the-hertzian-dipole-model|Radiation from Time-Varying Currents and the Hertzian Dipole Model]]
- [[general-electromagnetic-fields-of-a-hertzian-dipole|General Electromagnetic Fields of a Hertzian Dipole]]
- [[near-field-and-far-field-behavior|Near-Field and Far-Field Behavior]]

## Concept Dependencies

- enables: [[general-electromagnetic-fields-of-a-hertzian-dipole|General Electromagnetic Fields of a Hertzian Dipole]]
