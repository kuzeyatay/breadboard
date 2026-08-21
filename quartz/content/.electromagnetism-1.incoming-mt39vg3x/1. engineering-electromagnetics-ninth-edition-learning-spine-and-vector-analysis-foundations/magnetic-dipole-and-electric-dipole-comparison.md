---
title: "1.339 Magnetic Dipole and Electric Dipole Comparison"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 565, Problem 14.8"]
related: ["hertzian-dipole-field-regions-and-power-flow", "radiation-resistance-and-current-distribution"]
---

# 1.339 Magnetic Dipole and Electric Dipole Comparison

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 565, Problem 14.8

The magnetic-dipole exercise asks for the far-zone time-average Poynting vector after all terms of order $1/r^2$ and $1/r^4$ are neglected from the field expressions. The resulting far-zone power density is then compared with that of a Hertzian electric dipole. With equal current amplitudes, the problem requires a relation between loop radius $a$ and electric-dipole length $d$ that produces equal total radiated power. This is a reusable comparison method: reduce both antennas to their radiation-zone fields, form $\langle\mathbf{S}\rangle=\frac{1}{2}\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$, integrate over a sphere if total power is needed, and equate the two powers. The procedure separates geometry-dependent radiation strength from the common $1/r^2$ propagation behavior. It also reinforces electromagnetic duality between short electric-current elements and small current loops, while remaining grounded in the explicit field equations referenced by the problem. This topic supports later decisions about which compact radiator geometry can meet a given power requirement.

## Page-Grounded Details

#### Page 565

to a current element of differential length $d$, oriented along the $z$ axis, and centered at the origin.

$\underline{14.6}$ Evaluate the time-average Poynting vector, $<S>=\left(\frac{1}{2}\right)\mathcal{R}e\left\{E_{s}\times H_{s}^{*}\right\}$ for the Hertzian dipole, assuming the general case that involves the field components as given by Eqs. (10), (13$a$), and (13$b$). Compare your result to the far-zone case, Eq. (26).

$\underline{14.7}$ A short current element has $d=0.03\lambda$. Calculate the radiation resistance that is obtained for each of the following current distributions: ($a$) uniform, $I_{0}$; ($b$) linear, $I(z)=I_{0}(0.5d-|z|)/0.5d$; ($c$) step, $I_{0}$ for $0<|z|<0.25d$ and $0.5I_{0}$ for $0.25d<|z|<0.5d$.

$\underline{14.8}$ Evaluate the time-average Poynting vector, $<S>=(1/2)\mathcal{R}e\left\{E_{s}\times H_{s}^{*}\right\}$ for the magnetic dipole antenna in the far zone, in which all terms of order $1/r^{2}$ and $1/r^{4}$ are neglected in Eqs. (48), (49), and (50). Compare your result to the far-zone power density of the Hertzian dipole, Eq. (26). In this comparison, and assuming equal current amplitudes, what rel

[Truncated for analysis]

## Core Ideas

- The far-zone comparison neglects field contributions that lead to $1/r^2$ and $1/r^4$ terms in the specified expressions.
- Average power density is found from the complex Poynting vector.
- The magnetic dipole is represented by a small loop with radius $a$.
- The electric dipole is represented by a short current element with length $d$.
- Equal-current, equal-power operation is found by equating integrated radiation powers.
- Both radiators share spherical spreading in the far zone.

## Source Anchors

- Problem 14.8 explicitly asks for the far-zone Poynting vector of the magnetic dipole antenna.
- Problem 14.8 instructs the reader to neglect terms of order $1/r^2$ and $1/r^4$ in Eqs. (48), (49), and (50).
- The result is to be compared with the Hertzian dipole far-zone power density in Eq. (26).
- The problem asks for the relation between loop radius $a$ and dipole length $d$ that gives equal radiated powers for equal current amplitudes.

## Related Pages

- [[hertzian-dipole-field-regions-and-power-flow|Hertzian Dipole Field Regions and Power Flow]]
- [[radiation-resistance-and-current-distribution|Radiation Resistance and Current Distribution]]

## Concept Dependencies

- depends-on: [[hertzian-dipole-field-regions-and-power-flow|Hertzian Dipole Field Regions and Power Flow]]
