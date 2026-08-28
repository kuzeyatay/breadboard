---
title: "1.300 Mode Confinement and Mode Field Radius in Step-Index Fiber"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 520", "Page 521", "Figure 13.23", "Figure 13.24", "Problem D13.12"]
related: ["optical-fiber-and-dielectric-slab-design-procedures", "waveguide-dispersion-and-pulse-broadening", "guided-mode-cutoff-and-single-mode-operation"]
---

# 1.300 Mode Confinement and Mode Field Radius in Step-Index Fiber

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 520, Page 521, Figure 13.23, Figure 13.24, Problem D13.12

The mode field radius characterizes the transverse extent of the guided optical field and is an important commercial single-mode fiber specification alongside cutoff wavelength. In a weakly guiding step-index fiber, the radial field follows a Bessel-function dependence in the core and a modified Bessel-function dependence in the cladding, with the two solutions connecting at the core radius $\rho=a$. The source compares the first two linearly polarized modes and shows that $\mathrm{LP}_{11}$ is less tightly confined than $\mathrm{LP}_{01}$ at the same operating frequency. It also shows that increasing normalized frequency $V$ draws the $\mathrm{LP}_{01}$ mode power toward the fiber axis. Mode field radius directly affects engineering performance. Matched mode radii and precise axial alignment minimize connection or splice loss, while radius mismatch and lateral displacement increase loss. Larger mode radii relax alignment tolerance, but smaller radii improve resistance to bend-induced radiation because tightly confined modes are less likely to escape when the fiber curves. Since the mode parameters $u$ and $w$ can be obtained from the normalized mode radius, the propagation constant $\beta$ can also be inferred. Measuring mode field radius as a function of frequency therefore provides information about $\beta(\omega)$ and optical dispersion.

## Page-Grounded Details

#### Page 520

Figure 13.23 Intensity plots from Eqs. (160) and (161) of the first two LP modes in a weakly guiding step index fiber, as functions of normalized radius, $\rho/a$. Both functions were evaluated at the same operating frequency; the relatively weak confinement of the $\mathrm{LP_{11}}$ mode compared to that of $\mathrm{LP_{01}}$ is evident.

The mode field radius (at a quoted wavelength) is another important specification (along with the cutoff wavelength) of commercial single-mode fiber. It is important to know for several reasons: First, in splicing or connecting two single-mode fibers together, the lowest connection loss will be attained if both fibers have the same mode field radius, and if the fiber axes are precisely aligned. Different radii or displaced axes result in increased loss, but this can be calculated and compared with measurement. Alignment tolerance (allowable deviation from precise axis alignment) is relaxed somewhat if the fibers have larger mode field radii. Second, a smaller mode field radius means that the fiber is less likely to suffer loss as a result of bending. A loosely confined mode tends to radiate away more as the fiber is bent. Finally, mode fiel

[Truncated for analysis]

#### Page 521
$$
J_{0}(up/a)
$$
$$
a\quad K_{0}(wp/a)
$$
$$
n_{1}
$$
$$
n_{2}
$$
Figure 13.24 Intensity plots for the $LP_{01}$ mode in a weakly guiding step index fiber. Traces are shown for $V=1.0$ (solid), $V=1.2$ (dashed), and $V=1.5$ (dotted), corresponding to increases in frequency in those proportions. Dashed vertical lines indicate the core/cladding boundary, at which for all three cases, the $J_{0}$ radial dependence in the core connects to the $k_{0}$ radial dependence in the cladding, as demonstrated in Eq. (160). The migration of mode power toward the fiber axis as frequency increases is evident.

#### REFERENCES

1. Weeks, W. L. *Transmission and Distribution of Electrical Energy*. New York: Harper and Row, 1981. Line parameters for various configurations of power transmission and distribution systems are discussed in Chapter 2, along with typical parameter values.

2. Edwards, T. C. *Foundations for Microstrip Circuit Design*. Chichester, N.Y.: Wiley-Interscience, 1981. Chapters 3 and 4 provide an excellent treatment of microstrip lines, with many design formulas.

3. Ramo, S., J. R. Whinnery, and T. Van Duzer. *Fields and Waves in Communication Electronics*. 3d ed.

[Truncated for analysis]

## Core Ideas

- Mode field radius and cutoff wavelength are major specifications of commercial single-mode fiber.
- Lowest splice or connector loss requires matched mode field radii and aligned fiber axes.
- Radius mismatch or transverse axis displacement increases connection loss.
- A larger mode field radius permits somewhat greater alignment error.
- A smaller mode field radius provides stronger confinement and lower bend loss.
- The radial core and cladding solutions connect at $\rho=a$.
- Increasing normalized frequency $V$ moves modal power toward the fiber axis.
- Frequency-dependent mode field radius can be used to infer $\beta(\omega)$ and dispersion.

## Source Anchors

- Figure 13.23 compares $\mathrm{LP}_{01}$ and $\mathrm{LP}_{11}$ intensity versus normalized radius $\rho/a$ and shows weaker confinement of $\mathrm{LP}_{11}$.
- Figure 13.24 shows $\mathrm{LP}_{01}$ traces for $V=1.0$, $1.2$, and $1.5$, with power migrating toward the axis as frequency increases.
- The core dependence is labeled $J_0(u\rho/a)$ and the cladding dependence $K_0(w\rho/a)$.
- For the fiber of Example 13.6 with $a=5.0\,\mu\mathrm{m}$, the mode field radii are $6.78\,\mu\mathrm{m}$ at $1.55\,\mu\mathrm{m}$ and $5.82\,\mu\mathrm{m}$ at $1.30\,\mu\mathrm{m}$.
- The text states that $u$ and $w$, found from the normalized mode radius, permit calculation of the phase constant $\beta$.

## Related Pages

- [[optical-fiber-and-dielectric-slab-design-procedures|Optical Fiber and Dielectric Slab Design Procedures]]
- [[waveguide-dispersion-and-pulse-broadening|Waveguide Dispersion and Pulse Broadening]]
- [[guided-mode-cutoff-and-single-mode-operation|Guided-Mode Cutoff and Single-Mode Operation]]

## Concept Dependencies

- part-of: [[optical-fiber-and-dielectric-slab-design-procedures|Optical Fiber and Dielectric Slab Design Procedures]]
- related: [[waveguide-dispersion-and-pulse-broadening|Waveguide Dispersion and Pulse Broadening]]
