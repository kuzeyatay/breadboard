---
title: "1.306 Radiation from Time-Varying Currents and the Hertzian Dipole Model"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 527", "Page 528", "Section 14.1", "Figure 14.1"]
related: ["retarded-vector-potential-of-a-hertzian-dipole", "general-electromagnetic-fields-of-a-hertzian-dipole", "magnetic-dipole-and-electromagnetic-duality", "thin-wire-dipole-current-distribution"]
---

# 1.306 Radiation from Time-Varying Currents and the Hertzian Dipole Model

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 527, Page 528, Section 14.1, Figure 14.1

The antenna chapter begins by relaxing the assumption that time-varying electromagnetic fields remain completely confined to a circuit or waveguide. Incomplete confinement allows power to radiate into the surrounding medium, which may be an unwanted loss or interference mechanism. An antenna deliberately uses the same phenomenon as an interface between guided waves and free-space waves. The source states the central radiation principle: any time-varying current distribution radiates electromagnetic power. The foundational source model is a differential current filament of length $d$, infinitesimal cross section, centered at the origin, and oriented along $z$ in an infinite lossless medium with permeability $\mu$ and permittivity $\epsilon$. It carries the uniform current $I(t)=I_0\cos\omega t$ in the $\mathbf{a}_z$ direction. Charge continuity implies equal and opposite time-varying charges at the filament ends, so the source is called an elemental or Hertzian dipole. This idealized source is distinct from the more general practical dipole antenna, but its analytically tractable fields become the building blocks for studying larger antennas.

## Page-Grounded Details

#### Page 527

### Electromagnetic Radiation and Antennas

We are used to the idea that loss mechanisms in electrical devices, including transmission lines and waveguides, are associated with resistive effects in which electrical power is transformed into heat. We have also assumed that time-varying electric and magnetic fields are totally confined to a waveguide or circuit. In fact, confinement is rarely complete, and electromagnetic power will radiate away from the device to some degree. Radiation may generally be an unwanted effect, as it represents an additional power loss mechanism, or a device may receive unwanted signals from the surrounding region. On the other hand, a well-designed antenna provides an efficient interface between guided waves and free-space waves for purposes of intentionally radiating or receiving electromagnetic power. In either case, it is important to understand the radiation phenomenon so that it can either be used most effectively or be reduced to a minimum. In this chapter, our goal is to establish such an understanding and to explore several practical examples of antenna design.

#### 14.1 BASIC RADIATION PRINCIPLES: THE HERTZIAN DIPOLE

The essential point of thi

[Truncated for analysis]

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

## Core Ideas

- Electromagnetic confinement in practical circuits and guides is rarely complete.
- Radiation can represent loss or interference, or it can be used intentionally by an antenna.
- Any time-varying current distribution radiates electromagnetic power.
- The Hertzian dipole is a differential current filament with infinitesimal cross section.
- The filament is centered at the origin and oriented along the $z$ axis.
- Its current is uniform and sinusoidal: $I(t)=I_0\cos\omega t$.
- Time-varying end charges make the element an electric dipole.
- The elemental dipole provides a basis for more complicated antenna fields.

## Source Anchors

- The chapter introduction contrasts resistive heating losses with electromagnetic power that radiates away from a device.
- Section 14.1 states that any time-varying current distribution radiates electromagnetic power.
- Figure 14.1 shows a differential current filament of length $d$ carrying $I=I_0\cos\omega t$.
- The surrounding medium is lossless and specified by real $\mu$ and $\epsilon$.
- The source explains that equal and opposite instantaneous charges occur at the two wire ends.

## Related Pages

- [[retarded-vector-potential-of-a-hertzian-dipole|Retarded Vector Potential of a Hertzian Dipole]]
- [[general-electromagnetic-fields-of-a-hertzian-dipole|General Electromagnetic Fields of a Hertzian Dipole]]
- [[magnetic-dipole-and-electromagnetic-duality|Magnetic Dipole and Electromagnetic Duality]]
- [[thin-wire-dipole-current-distribution|Thin-Wire Dipole Current Distribution]]

## Concept Dependencies

- enables: [[retarded-vector-potential-of-a-hertzian-dipole|Retarded Vector Potential of a Hertzian Dipole]]
