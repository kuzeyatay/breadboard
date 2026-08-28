---
title: "1.348 Electromagnetic Unit Systems and Conversion"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 576, Appendix B", "Page 577, Tables B.2 and B.3"]
related: ["si-foundations-and-free-space-electromagnetic-constants", "material-constitutive-parameters-and-physical-constants"]
---

# 1.348 Electromagnetic Unit Systems and Conversion

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 576, Appendix B, Page 577, Tables B.2 and B.3

The source contrasts SI with electrostatic, electromagnetic, Gaussian, and Heaviside-Lorentz unit systems. In the electrostatic cgs system, free-space Coulomb's law is written $F=Q_1Q_2/R^2$, so the free-space permittivity is assigned unity and units commonly carry the prefix stat-. In the electromagnetic cgs system, free-space permeability is unity and units use the prefix ab-. Mixing electric quantities in esu with magnetic quantities in emu produces the Gaussian system, where the speed of light appears explicitly in Maxwell's equations. The source gives a Gaussian curl equation in the form
$$
\nabla\times\mathbf{H}=4\pi\mathbf{J}+\frac{1}{c}\frac{\partial\mathbf{D}}{\partial t}
$$
 A rationalized system places the $4\pi$ factor in Coulomb's law rather than Maxwell's equations. Accordingly, Gaussian units are described as unrationalized cgs, Heaviside-Lorentz as rationalized cgs, and SI as rationalized mks. Table B.2 supplies conversions such as $1\ \mathrm{m}=10^2\ \mathrm{cm}$, $1\ \mathrm{N}=10^5$ dynes, $1\ \mathrm{J}=10^7$ ergs, $1\ \mathrm{T}=10^4$ gauss, and $1\ \mathrm{Wb}=10^8$ maxwells. Table B.3 catalogs SI prefixes from atto to exa.

## Page-Grounded Details

#### Page 576

Table B.1 (Continued)

<table><tr><td>Symbol</td><td>Name</td><td>Unit</td><td>Abbreviation</td></tr><tr><td>ω</td><td>Radian frequency</td><td>radian/second</td><td>rad/s</td></tr><tr><td>c</td><td>Velocity of light</td><td>meter/second</td><td>m/s</td></tr><tr><td>λ</td><td>Wavelength</td><td>meter</td><td>m</td></tr><tr><td>η</td><td>Intrinsic impedance</td><td>ohm</td><td>Ω</td></tr><tr><td>k</td><td>Wave number</td><td>meter⁻^1</td><td>m⁻^1</td></tr><tr><td>α</td><td>Attenuation constant</td><td>neper/meter</td><td>Np/m</td></tr><tr><td>β</td><td>Phase constant</td><td>radian/meter</td><td>rad/m</td></tr><tr><td>f</td><td>Frequency</td><td>hertz</td><td>Hz</td></tr><tr><td>S</td><td>Poynting vector</td><td>watt/meter^2</td><td>W/m^2</td></tr><tr><td>P</td><td>Power</td><td>watt</td><td>W</td></tr><tr><td>δ</td><td>Skin depth</td><td>meter</td><td>m</td></tr><tr><td>Γ</td><td>Reflection coefficient</td><td></td><td></td></tr><tr><td>s</td><td>Standing wave ratio</td><td></td><td></td></tr><tr><td>γ</td><td>Propagation constant</td><td>meter⁻^1</td><td>m⁻^1</td></tr><tr><td>G</td><td>Conductance</td><td>siemen</td><td>S</td></tr><tr><td>Z</td><td>Impedance</td><td>ohm</td><td>Ω<

[Truncated for analysis]

#### Page 577

Table B.2 Conversion of International to Gaussian and other units (use c = 2.99792458 x $10^{8}$)

<table><tr><td>Quantity</td><td>1 mks unit</td><td>= Gaussian units</td><td>= Other units</td></tr><tr><td>d</td><td>1 m</td><td>$10^{2}$ cm</td><td>39.37 in.</td></tr><tr><td>F</td><td>1 N</td><td>$10^{5}$ dyne</td><td>0.2248 $lb_{f}$</td></tr><tr><td>W</td><td>1 J</td><td>$10^{7}$ erg</td><td>0.7376 ft- $lb_{f}$</td></tr><tr><td>Q</td><td>1 C</td><td>10c statC</td><td>0.1 abC</td></tr><tr><td>$\rho_{v}$</td><td>$1 \mathrm{C/m}^{3}$</td><td>$$10^{-5}c$statC/cm$^{3}$</td><td>$10^{-7}$abC/cm$^{3}$</td></tr><tr><td>D</td><td>$ 1 \mathrm{C/m}^{2} $</td><td>$ 4\pi10^{-3}c $(esu)</td><td>$ 4\pi10^{-5} $(emu)</td></tr><tr><td>E</td><td>1 V/m</td><td>$ 10^{4}/c $statV/cm</td><td>$ 10^{6} $abV/cm</td></tr><tr><td>V</td><td>1 V</td><td>$ 10^{6}/c $statV</td><td>$ 10^{8} $abV</td></tr><tr><td>I</td><td>1 A</td><td>0.1 abA</td><td>$ 10c $statA</td></tr><tr><td>H</td><td>1 A/m</td><td>$ 4\pi10^{-3} $oersted</td><td>$ 0.4\pi c $(esu)</td></tr><tr><td>$ V_{m} $</td><td>1 A*t</td><td>0.4$ \pi $gilbert</td><td>$ 40\pi c $(esu)</td></tr><tr><td>B</td><td>1 T</td><td>$ 10^{4} $ gaus

[Truncated for analysis]

## Core Ideas

- The esu system assigns $\epsilon_0=1$ and uses stat- units.
- The emu system assigns $\mu_0=1$ and uses ab- units.
- The Gaussian system mixes esu electric and emu magnetic quantities.
- The speed of light appears explicitly in Gaussian Maxwell equations.
- Gaussian units are unrationalized cgs, while SI is rationalized mks.
- Table B.2 converts major SI electromagnetic quantities to Gaussian and other units.
- SI prefixes span powers from $10^{-18}$ to $10^{18}$ in Table B.3.

## Source Anchors

- Page 576 gives the esu Coulomb law $F=Q_1Q_2/R^2$.
- Page 576 states that stat- identifies esu units and ab- identifies emu units.
- Page 576 explains $\mu_0=1/c^2$ in esu and $\epsilon_0=1/c^2$ in emu.
- Page 576 gives the Gaussian curl equation with explicit $4\pi$ and $1/c$ factors.
- Table B.2 on Page 577 lists SI-to-Gaussian conversion factors.
- Table B.3 on Page 577 lists standard SI prefixes and powers of ten.

## Related Pages

- [[si-foundations-and-free-space-electromagnetic-constants|SI Foundations and Free-Space Electromagnetic Constants]]
- [[material-constitutive-parameters-and-physical-constants|Material Constitutive Parameters and Physical Constants]]

## Concept Dependencies

- depends-on: [[si-foundations-and-free-space-electromagnetic-constants|SI Foundations and Free-Space Electromagnetic Constants]]
