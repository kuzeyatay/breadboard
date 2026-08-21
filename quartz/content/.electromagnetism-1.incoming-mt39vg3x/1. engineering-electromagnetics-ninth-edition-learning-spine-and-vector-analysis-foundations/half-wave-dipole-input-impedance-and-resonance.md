---
title: "1.323 Half-Wave Dipole Input Impedance and Resonance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 547", "Page 548", "Section 14.4.4", "Figure 14.9"]
related: ["half-wave-dipole-pattern-and-performance", "radiation-intensity-directivity-and-radiation-resistance", "monopole-antenna-and-image-theory"]
---

# 1.323 Half-Wave Dipole Input Impedance and Resonance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 547, Page 548, Section 14.4.4, Figure 14.9

The half-wave dipole is attractive partly because its feed lies one-quarter wavelength from each open end, where the standing-wave current is largest. An idealized lossless argument would make the driving-point impedance purely real and equal to the $73\ \Omega$ radiation resistance. A real dipole, however, is an unfolded transmission line rather than an ideal quarter-wave line section, so an appreciable input reactance remains at an exact length of $\lambda/2$. For a thin lossless dipole, the source gives $Z_{\mathrm{in}}=73+jX\ \Omega$, with $X$ near $40\ \Omega$. The reactance is highly sensitive to length and can be driven to zero by reducing the overall length slightly below $\lambda/2$, while leaving the resistance nearly unchanged. Dipoles at integer multiples of a half-wavelength show related behavior but have much larger radiation resistances and poorer feed-line matching. Lengths between these multiples can exhibit reactances near $j600\ \Omega$ and sensitivity to wire thickness. Practical matching therefore uses slight length adjustment or external matching techniques.

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

## Core Ideas

- The half-wave dipole feed is located at the standing-wave current maximum.
- An idealized resonant model associates the feed resistance with the $73\ \Omega$ radiation resistance.
- An exact thin, lossless half-wave dipole has approximately $Z_{\mathrm{in}}=73+j40\ \Omega$.
- Input reactance is extremely sensitive to antenna length.
- A slight reduction below $\lambda/2$ can reduce the reactance to zero.
- The resistance remains essentially unchanged during this small length adjustment.
- Higher half-wavelength multiples have considerably larger radiation resistance.
- Intermediate lengths can have reactance near $j600\ \Omega$ and sensitivity to wire thickness.

## Source Anchors

- Page 547 states that the standing-wave current amplitude maximizes at the feed of the half-wave dipole.
- The idealized driving-point resistance is identified with the $73\ \Omega$ radiation resistance.
- Page 547 gives $Z_{\mathrm{in}}=73+jX$ with $X$ in the vicinity of $40\ \Omega$ for an exactly half-wave thin lossless dipole.
- A slight shortening below $\lambda/2$ is said to reduce the reactance to zero while leaving the real part essentially unaffected.
- Reactances near $j600\ \Omega$ are reported for lengths between half-wavelength multiples.
- Figure S26.P548.F14.9 plots directivity and radiation resistance against overall antenna length.
- Figure 14.9 shows modest directivity growth and a local radiation-resistance maximum between $3\lambda/4$ and $\lambda$.

## Related Pages

- [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
- [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
- [[monopole-antenna-and-image-theory|Monopole Antenna and Image Theory]]

## Concept Dependencies

- depends-on: [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
