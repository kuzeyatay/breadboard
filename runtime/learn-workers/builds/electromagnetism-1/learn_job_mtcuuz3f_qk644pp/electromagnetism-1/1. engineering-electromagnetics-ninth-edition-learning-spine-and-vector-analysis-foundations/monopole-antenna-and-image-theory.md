---
title: "1.324 Monopole Antenna and Image Theory"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 547", "Page 548", "Page 549", "Section 14.4.5", "Figure 14.10", "Problem D14.5"]
related: ["half-wave-dipole-pattern-and-performance", "radiation-intensity-directivity-and-radiation-resistance", "half-wave-dipole-input-impedance-and-resonance"]
---

# 1.324 Monopole Antenna and Image Theory

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 547, Page 548, Page 549, Section 14.4.5, Figure 14.10, Problem D14.5

An ideal monopole consists of one-half of a dipole mounted on a perfectly conducting plane. Image theory replaces the conducting plane with a mirror-image antenna, so the physical monopole and its image together reproduce the corresponding full dipole. All dipole field equations therefore apply in the upper half-space. The Poynting vector above the plane is the same as for the equivalent dipole, but total power is integrated over only a hemisphere rather than a full sphere. Consequently, the monopole radiates one-half the total power and has one-half the radiation resistance of the equivalent dipole. A quarter-wave monopole and its image form a half-wave dipole, so its radiation resistance is $73/2=36.5\ \Omega$. A coaxial feed can approach from beneath the conducting plane, with its center conductor connected to the monopole and its outer conductor connected to the plane. If access below the plane is inconvenient, the coaxial cable can lie on top with its outer conductor bonded to the plane. AM broadcast towers and citizens' band antennas are cited as practical monopole examples.

## Page-Grounded Details

#### Page 547

In the half-wave dipole, the standing wave current amplitude maximizes at the feed point, and the antenna is said to be operated on resonance. As a result, the driving point impedance, one-quarter wavelength in front of the open ends, would in principle be purely real$^{4}$ and equal to the 73-Ω radiation resistance, assuming that the antenna is otherwise lossless. This is the primary motivation for using half-wave dipoles, in that they provide a fairly close impedance match to conventional transmission lines (whose characteristic impedances are on the same order).

Actually, because the antenna is essentially an unfolded transmission line, the half-wave dipole does not behave as an ideal quarter-wave transmission line section, as we might suspect considering the discussions in Section 14.1. An appreciable reactive part of the input impedance will likely be present, but the half-wavelength dimension is very close to the length at which the reactance goes to zero. Methods of evaluating the reactance are beyond the scope of our treatment, but are considered in detail in Ref. 1. For a thin lossless dipole of length exactly $\lambda/2$, the input impedance would be $ Z_{\rm in}=73+

[Truncated for analysis]

#### Page 548

Figure 14.9 Plots of directivity (black) and radiation resistance (blue) as functions of overall antenna length, expressed in wavelengths.

monopole (presenting a half-wave dipole when including the image) yields a radiation resistance of $R_{\rm rad}=36.5\,\Omega$.

Monopole antennas may be driven by a coaxial cable below the plane, having its center conductor connected to the antenna through a small hole, and having its outer conductor connected to the plane. If the region below the plane is inaccessible or inconvenient, the coax may be laid on top of the plane and its outer conductor connected to it. Examples of this type of antenna include AM broadcasting towers and citizens' band antennas.

Figure 14.10 (a) An ideal monopole is always associated with a perfectly conducting plane. (b) The monopole plus its image form a dipole.

#### Page 549

D14.5. The monopole antenna of Figure 14.10$a$ has a length $d/2=0.080$ m and may be assumed to carry a triangular current distribution for which the feed current $I_{0}$ is 16.0 A at a frequency of 375 MHz in free space. At point $P$ ($r=400$ m, $\theta=60^{\circ}$, $\phi=45^{\circ}$) find (a) $H_{\phi s}$, (b) $E_{\theta s}$, and (c) the amplitude of $\mathcal{P}_{r}$.

Ans. (a) j1.7 mA/m; (b) j0.65 V/m; (c) 1.1 W/m^2

#### 14.5 Arrays of Two Elements

We next address the problem of establishing better control of the directional properties of antenna radiation. Although some control of directivity is achieved through adjustment of the length of a wire antenna, these results only appear as changes in the $E$-plane pattern. The $H$-plane pattern always remains a circle (no $\phi$ variation), as long as a single vertical wire antenna is used. By using multiple elements in an array, significant improvement in directivity as determined in both $E$ and $H$ planes can be achieved. Our objective in this section is to lay the groundwork for the analysis of arrays by considering the simple case of using two elements. The resulting methods are readily extendabl

[Truncated for analysis]

## Core Ideas

- An ideal monopole is one-half of a dipole above a perfectly conducting plane.
- The monopole and its image form an equivalent full dipole.
- Dipole field equations apply directly in the upper half-space.
- The monopole has the same upper-half-space Poynting vector as the equivalent dipole.
- Integration over only one hemisphere halves the total radiated power.
- The monopole radiation resistance is half that of the corresponding dipole.
- A quarter-wave monopole has $R_{\mathrm{rad}}=36.5\ \Omega$.
- Coaxial feeding connects the center conductor to the monopole and outer conductor to the ground plane.

## Source Anchors

- Figure S26.P548.F14.10a shows an ideal monopole associated with a perfectly conducting plane.
- Figure S26.P548.F14.10b shows the monopole and its image forming a dipole.
- Page 547 states that all dipole field equations apply directly to the upper half-space.
- Page 547 states that radiated power and radiation resistance are one-half the equivalent dipole values.
- Page 548 gives $R_{\mathrm{rad}}=36.5\ \Omega$ for a quarter-wave monopole.
- Page 548 identifies AM broadcasting towers and citizens' band antennas as examples.
- Problem D14.5, Page 549 gives a monopole calculation with answers $H_{\phi s}=j1.7$ mA/m, $E_{\theta s}=j0.65$ V/m, and radial power-density amplitude $1.1$ W/m$^2$.

## Related Pages

- [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
- [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
- [[half-wave-dipole-input-impedance-and-resonance|Half-Wave Dipole Input Impedance and Resonance]]

## Concept Dependencies

- depends-on: [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
- applies-to: [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
