---
title: "1.294 Weakly Guiding Step-Index Fiber and LP Modes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 512, Section 13.7 and Section 13.7.1", "Page 513, weak-guidance LP-mode description"]
related: ["cylindrical-wave-equation-and-bessel-function-solutions", "weak-guidance-fiber-fields-and-mode-intensity", "fiber-eigenvalue-equation-and-normalized-frequency", "symmetric-dielectric-slab-waveguide-and-total-internal-reflection"]
---

# 1.294 Weakly Guiding Step-Index Fiber and LP Modes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 512, Section 13.7 and Section 13.7.1, Page 513, weak-guidance LP-mode description

A step-index optical fiber consists of a high-index core of radius a surrounded by lower-index cladding. It confines light by total internal reflection, although an evanescent fraction of modal power remains in the cladding. The analysis is more difficult than for a slab because the cross section is circular and ray paths can be three-dimensional. Meridional rays cross the fiber axis, while skew rays avoid it and follow spiral-like paths. The weak-guidance condition $n_1\doteq n_2$ greatly simplifies the field description and is typical of commercial fibers, where the index difference is only a small fraction of a percent. Under this approximation, modes are nearly transverse and linearly polarized. An x-polarized mode has approximately y-directed magnetic field, negligible longitudinal components, and $E_x\doteq\eta H_y$. Such modes are labeled $\mathrm{LP}_{\ell m}$. The azimuthal index $\ell$ controls angular intensity variations, while the radial index m counts maxima encountered along a radial line.

## Page-Grounded Details

#### Page 512

Clearly, fabrication tolerances are very exacting when constructing dielectric guides for single-mode operation!

D13.11 A 0.5-mm-thick slab of glass ($n_{1}=1.45$) is surrounded by air ($n_{2}=1$). The slab waveguides infrared light at wavelength $\lambda=1.0\,\mu$m. How many TE and TM modes will propagate?

Ans. 2102

#### 13.7 OPTICAL FIBER

Optical fiber works on the same principle as the dielectric slab waveguide, except of course for the round cross section. A _step index_ fiber is shown in Figure 13.10, in which a high-index $\mathit{core}$ of radius $a$ is surrounded by a lower-index $\mathit{cladding}$ of radius $b$. Light is confined to the core through the mechanism of total reflection, but again some frac-tion of the power resides in the cladding as well. As we found in the slab waveguide, the cladding power again moves in toward the core as frequency is raised. Additionally, as is true in the slab waveguide, the fiber supports a mode that has no cutoff.

Analysis of the optical fiber is complicated. This is mainly because of the round cross section, along with the fact that it is generally a three-dimensional problem; the slab waveguide had only two dimen

[Truncated for analysis]

#### Page 513

The main result of the weak-guidance condition is that a set of modes appears in which each mode is linearly polarized. This means that light having x-polarization, for example, will enter the fiber and establish itself in a mode or in a set of modes that preserve the x-polarization. Magnetic field is essentially orthogonal to E, and so it would in that case lie in the y direction. The z components of both fields, although present, are too weak to be of significance; the nearly equal core and cladding indices lead to ray paths that are essentially parallel to the guide axis-deviating only slightly. In fact, we may write for a given mode, $E_{x}\doteq\eta H_{y}$, when $\eta$ is approximated as the intrinsic impedance of the cladding. Therefore, in the weak-guidance approximation, the fiber mode fields are treated as plane waves (nonuniform, of course). The designation for these modes is $\mathrm{LP}_{\ell m}$, meaning linearly polarized, with integer order parameters $\ell$ and $m$. The latter express the numbers of variations over the two dimensions in the circular transverse plane. Specifically, $\ell$, the azimuthal mode number, is one-half the number of power density

[Truncated for analysis]

## Core Ideas

- A step-index fiber has a high-index core and lower-index cladding.
- Some modal power resides in the cladding even under total internal reflection.
- Meridional rays cross the axis, while skew rays follow off-axis spiral-like paths.
- Weak guidance means $n_1\doteq n_2$.
- Commercial single-mode fibers commonly have 5 to 10 micrometer core diameters and 125 micrometer cladding diameters.
- Weakly guided modes are approximately linearly polarized and nearly transverse.
- The field relation is approximately $E_x\doteq\eta H_y$.
- LP indices describe azimuthal and radial field variation.

## Source Anchors

- Page 512 describes a core of radius a and cladding of radius b, with confinement by total reflection and some power in the cladding.
- The source distinguishes meridional rays that pass through the z axis from skew rays that avoid it.
- Page 512 defines weak guidance as $n_1\doteq n_2$ and notes that most commercial fibers satisfy it.
- Typical dimensions are given as 5 to 10 $\mu$m core diameter and 125 $\mu$m cladding diameter.
- Page 513 states that longitudinal field components are weak and that $E_x\doteq\eta H_y$.
- The source defines $\ell$ as one-half the number of azimuthal power-density extrema and m as the number of radial maxima.

## Related Pages

- [[cylindrical-wave-equation-and-bessel-function-solutions|Cylindrical Wave Equation and Bessel-Function Solutions]]
- [[weak-guidance-fiber-fields-and-mode-intensity|Weak-Guidance Fiber Fields and Mode Intensity]]
- [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]
- [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]

## Concept Dependencies

- derives-from: [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
- depends-on: [[cylindrical-wave-equation-and-bessel-function-solutions|Cylindrical Wave Equation and Bessel-Function Solutions]]
