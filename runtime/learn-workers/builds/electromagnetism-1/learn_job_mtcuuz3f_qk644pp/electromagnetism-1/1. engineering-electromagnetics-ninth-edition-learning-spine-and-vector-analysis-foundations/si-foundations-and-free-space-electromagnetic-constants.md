---
title: "1.347 SI Foundations and Free-Space Electromagnetic Constants"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Pages 573-574, Appendix B", "Pages 575-576, Table B.1"]
related: ["electromagnetic-unit-systems-and-conversion", "material-constitutive-parameters-and-physical-constants"]
---

# 1.347 SI Foundations and Free-Space Electromagnetic Constants

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Pages 573-574, Appendix B, Pages 575-576, Table B.1

The units appendix describes the SI framework used in the text. The meter is defined as the distance light travels in vacuum during $1/299{,}792{,}458$ second, making the assigned vacuum light speed exactly $299{,}792{,}458\ \mathrm{m/s}$ in the source's account. The second is tied to 9,192,631,770 periods of a specified cesium-133 transition. The text also describes definitions of the kilogram, kelvin, candela, and ampere current standard used by the edition. From the force per unit length between parallel currents,
$$
F=\mu_0\frac{I^2}{2\pi d}
$$
 the stated ampere definition leads to
$$
\mu_0=4\pi\times10^{-7}\ \mathrm{H/m}
$$
 Electromagnetic wave speed then connects the vacuum constants through
$$
c=\frac{1}{\sqrt{\mu_0\epsilon_0}}
$$
 so
$$
\epsilon_0=\frac{1}{\mu_0c^2}=8.854187817\times10^{-12}\ \mathrm{F/m}
$$
 The chapter's unit table extends these foundations to field, circuit, wave, and material quantities, including $\mathbf{E}$ in V/m, $\mathbf{H}$ in A/m, $\mathbf{B}$ in T, power density in W/m$^2$, impedance in ohms, wavelength in meters, and propagation constants in inverse meters.

## Page-Grounded Details

#### Page 573

### Units

We describe first the International System (abbreviated SI, for Système International d'Unités), which is used in this book and is now standard in electrical engineering and much of physics. It has also been officially adopted as the international system of units by many countries, including the United States.^1

The fundamental unit of length is the meter, which was defined in the latter part of the nineteenth century as the distance between two marks on a certain platinum-iridium bar. The definition was improved in 1960 by relating the meter to the wavelength of the radiation emitted by the rare gas isotope krypton-86 under certain specified conditions. This so-called krypton meter was accurate to four parts per billion, a value leading to negligible uncertainties in constructing skyscrapers or building highways, but capable of causing an error greater than one meter in determining the distance to the moon. The meter was redefined in 1983 in terms of the velocity of light. At that time the velocity of light was specified to be an auxiliary constant with an _exact_ value of 299,792,458 meters per second. As a result, the latest definition of the meter is the distance li

[Truncated for analysis]

#### Page 574

This definition of the second, complex though it may be, permits time to be measured with an accuracy better than one part in $10^{13}$.

The standard mass of one kilogram is defined as the mass of an international standard in the form of a platinum-iridium cylinder at the International Bureau of Weights and Measures at Sèvres, France.

The unit of temperature is the kelvin, defined by placing the triple-point temperature of water at 273.16 kelvins.

A fifth unit is the candela, in which one candela is the luminous intensity in a given direction of a source that emits monochromatic radiation at frequency 5.40 x $10^{14}$ Hz (556 nm wavelength in free space), in which the radiation intensity in that direction is 1/683 W/Sr.

The last of the fundamental units is the ampere. Before explicitly defining the ampere, we must first define the newton. It is defined in terms of the other fundamental units from Newton's third law as the force required to produce an acceleration of one meter per second per second on a one-kilogram mass. We now may define the ampere as that constant current, flowing in opposite directions in two straight parallel conductors of infinite length and negligible

[Truncated for analysis]

#### Page 575

Table B.1 Names and units of the electric and magnetic quantities in the International System (in the order in which they appear in the text)

<table><tr><td>Symbol</td><td>Name</td><td>Unit</td><td>Abbreviation</td></tr><tr><td>v</td><td>Velocity</td><td>meter/second</td><td>m/s</td></tr><tr><td>F</td><td>Force</td><td>newton</td><td>N</td></tr><tr><td>Q</td><td>Charge</td><td>coulomb</td><td>C</td></tr><tr><td>r, R</td><td>Distance</td><td>meter</td><td>m</td></tr><tr><td>$\epsilon_{0}, \epsilon$</td><td>Permittivity</td><td>farad/meter</td><td>F/m</td></tr><tr><td>E</td><td>Electric field intensity</td><td>volt/meter</td><td>V/m</td></tr><tr><td>$\rho_{v}$</td><td>Volume charge density</td><td>coulomb/meter^3</td><td>C/m^3</td></tr><tr><td>v</td><td>Volume</td><td>meter^3</td><td>m^3</td></tr><tr><td>$\rho_{L}$</td><td>Linear charge density</td><td>coulomb/meter</td><td>C/m</td></tr><tr><td>$\rho_{S}$</td><td>Surface charge density</td><td>coulomb/meter^2</td><td>C/m^2</td></tr><tr><td>Ψ</td><td>Electric flux</td><td>coulomb</td><td>C</td></tr><tr><td>D</td><td>Electric flux density</td><td>coulomb/meter^2</td><td>C/m^2</td></tr><tr><td>S</td><td>Area</td><td>meter^2</td><td>m^2

[Truncated for analysis]

#### Page 576

Table B.1 (Continued)

<table><tr><td>Symbol</td><td>Name</td><td>Unit</td><td>Abbreviation</td></tr><tr><td>ω</td><td>Radian frequency</td><td>radian/second</td><td>rad/s</td></tr><tr><td>c</td><td>Velocity of light</td><td>meter/second</td><td>m/s</td></tr><tr><td>λ</td><td>Wavelength</td><td>meter</td><td>m</td></tr><tr><td>η</td><td>Intrinsic impedance</td><td>ohm</td><td>Ω</td></tr><tr><td>k</td><td>Wave number</td><td>meter⁻^1</td><td>m⁻^1</td></tr><tr><td>α</td><td>Attenuation constant</td><td>neper/meter</td><td>Np/m</td></tr><tr><td>β</td><td>Phase constant</td><td>radian/meter</td><td>rad/m</td></tr><tr><td>f</td><td>Frequency</td><td>hertz</td><td>Hz</td></tr><tr><td>S</td><td>Poynting vector</td><td>watt/meter^2</td><td>W/m^2</td></tr><tr><td>P</td><td>Power</td><td>watt</td><td>W</td></tr><tr><td>δ</td><td>Skin depth</td><td>meter</td><td>m</td></tr><tr><td>Γ</td><td>Reflection coefficient</td><td></td><td></td></tr><tr><td>s</td><td>Standing wave ratio</td><td></td><td></td></tr><tr><td>γ</td><td>Propagation constant</td><td>meter⁻^1</td><td>m⁻^1</td></tr><tr><td>G</td><td>Conductance</td><td>siemen</td><td>S</td></tr><tr><td>Z</td><td>Impedance</td><td>ohm</td><td>Ω<

[Truncated for analysis]

## Core Ideas

- The meter is tied to the exact assigned value of the vacuum light speed.
- The second is tied to a cesium-133 transition frequency.
- The source derives $\mu_0=4\pi\times10^{-7}\ \mathrm{H/m}$ from its ampere definition.
- Free-space wave speed satisfies $c=1/\sqrt{\mu_0\epsilon_0}$.
- The resulting source value is $\epsilon_0=8.854187817\times10^{-12}\ \mathrm{F/m}$.
- Electromagnetic derived units are related to the fundamental SI units.

## Source Anchors

- Page 573 defines the meter using $1/299{,}792{,}458$ second of light travel in vacuum.
- Page 573 states 9,192,631,770 periods for the cesium-133 definition of the second.
- Page 574 gives $F=\mu_0I^2/(2\pi d)$.
- Page 574 derives $\mu_0=4\pi\times10^{-7}\ \mathrm{H/m}$.
- Page 574 gives $c=1/\sqrt{\mu_0\epsilon_0}$ and computes $\epsilon_0$.
- Tables B.1 on Pages 575-576 list names, units, and abbreviations for electromagnetic quantities.

## Related Pages

- [[electromagnetic-unit-systems-and-conversion|Electromagnetic Unit Systems and Conversion]]
- [[material-constitutive-parameters-and-physical-constants|Material Constitutive Parameters and Physical Constants]]

## Concept Dependencies

- contrasts-with: [[electromagnetic-unit-systems-and-conversion|Electromagnetic Unit Systems and Conversion]]
