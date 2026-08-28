---
title: "1.284 Rectangular Waveguide Cutoff Condition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 500, Section 13.5.4 and Equations (97) through (100)"]
related: ["rectangular-waveguide-geometry-and-absence-of-tem", "rectangular-waveguide-tm-eigenmodes", "rectangular-waveguide-te-eigenmodes", "parallel-plate-mode-propagation-and-cutoff"]
---

# 1.284 Rectangular Waveguide Cutoff Condition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 500, Section 13.5.4 and Equations (97) through (100)

The rectangular-guide propagation constant combines the two quantized transverse variations. Starting from
$$
\beta_{mp}=\sqrt{k^2-\kappa_{mp}^2}
$$
 and using $\kappa_{mp}^2=(m\pi/a)^2+(p\pi/b)^2$, the axial phase constant becomes
$$
\beta_{mp}=\sqrt{k^2-\left(\frac{m\pi}{a}\right)^2-\left(\frac{p\pi}{b}\right)^2}
$$
 With $k=\omega\sqrt{\mu\epsilon}$, define the modal cutoff frequency as
$$
\omega_{c,mp}=\frac{1}{\sqrt{\mu\epsilon}}\left[\left(\frac{m\pi}{a}\right)^2+\left(\frac{p\pi}{b}\right)^2\right]^{1/2}
$$
 Then
$$
\beta_{mp}=\omega\sqrt{\mu\epsilon}\sqrt{1-\left(\frac{\omega_{c,mp}}{\omega}\right)^2}
$$
 A rectangular TE or TM mode propagates only when $\omega>\omega_{c,mp}$, which makes $\beta_{mp}$ real. The same cutoff formula applies to both mode families, but the allowed index combinations differ: TM requires $m,p\ge1$, while TE permits one index to be zero.

## Page-Grounded Details

#### Page 500

where we define $A =$ $A_{m}^{\prime}C_{p}^{\prime}$. Applying Eqs. (79a) through (79d) to (96a) gives the transverse field components:
$$
H_{xs}=j\beta_{mp}\frac{\kappa_{m}}{\kappa_{mp}^{2}}A\sin(\kappa_{mr}x)\cos\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96b)
$$
$$
H_{ys}=j\beta_{mp}\frac{\kappa_{p}}{\kappa_{mp}^{2}}A\cos(\kappa_{mr}x)\sin\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96c)
$$
$$
E_{xs}=j\omega\mu\frac{\kappa_{p}}{\kappa_{mp}^{2}}A\cos(\kappa_{mr}x)\sin\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96d)
$$
$$
E_{ys}=-j\omega\mu\frac{\kappa_{m}}{\kappa_{mp}^{2}}A\sin(\kappa_{mr}x)\cos\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96e)
$$
These field components pertain to modes designated $\text{TE}_{mp}$. For these modes, either m or p may be zero, thus allowing for the possibility of the important $\text{TE}_{m0}$ or $\text{TE}_{0p}$ cases, as will be discussed later. Some very good illustrations of TE and TM modes are presented in Reference 3.

#### 13.5.4 Cutoff Conditions

The phase constant for a given mode can be expressed using Eq. (81):
$$
\beta_{mp}=\sqrt{k^{2}-\kappa_{mp}^{2}}(97)
$$
Then, using (86), along with (90a) and (90b), we ha

[Truncated for analysis]

## Core Ideas

- Both transverse dimensions contribute to rectangular-guide cutoff.
- The axial constant is $\beta_{mp}=\sqrt{k^2-(m\pi/a)^2-(p\pi/b)^2}$.
- The cutoff frequency depends on the guide dimensions $a$ and $b$.
- It also depends on the filling medium through $\mu$ and $\epsilon$.
- Propagation requires $\omega>\omega_{c,mp}$.
- The cutoff expression applies to both TE and TM modes.
- TE and TM families differ in which index combinations are permitted.

## Source Anchors

- Equation (97) gives $\beta_{mp}=\sqrt{k^2-\kappa_{mp}^2}$.
- Equation (98) inserts the quantized $x$ and $y$ transverse constants.
- Equation (99) writes the phase constant in normalized cutoff form.
- Equation (100) defines the rectangular-guide radian cutoff frequency.
- The source states that $\omega$ must exceed $\omega_{c,mp}$ for real $\beta_{mp}$ and propagation.
- The source states that Equation (100) applies to both TE and TM modes.

## Related Pages

- [[rectangular-waveguide-geometry-and-absence-of-tem|Rectangular Waveguide Geometry and Absence of TEM]]
- [[rectangular-waveguide-tm-eigenmodes|Rectangular Waveguide TM Eigenmodes]]
- [[rectangular-waveguide-te-eigenmodes|Rectangular Waveguide TE Eigenmodes]]
- [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]

## Concept Dependencies

- related: [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
