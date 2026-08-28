---
title: "1.268 TEM Transmission-Line Waves and Waveguide Modes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 478, Section 13.2", "Page 479, Figures 13.7 through 13.9", "Page 480, Figures 13.10 and 13.11", "Page 481, Figure 13.12", "Page 495, Section 13.5"]
related: ["plane-wave-model-of-guided-modes", "te-and-tm-polarization-in-parallel-plate-guides", "rectangular-waveguide-geometry-and-absence-of-tem"]
---

# 1.268 TEM Transmission-Line Waves and Waveguide Modes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 478, Section 13.2, Page 479, Figures 13.7 through 13.9, Page 480, Figures 13.10 and 13.11, Page 481, Figure 13.12, Page 495, Section 13.5

A transmission line and a waveguide are distinguished primarily by their supported field configurations rather than by shape alone. A conventional transmission line contains two or more conductors and normally supports a transverse electromagnetic, or TEM, wave. In a TEM wave, both $\mathbf{E}$ and $\mathbf{H}$ lie entirely in the plane transverse to propagation, and the wavevector and Poynting vector point along the guide axis. A waveguide can contain one conductor, multiple conductors, or no conductors, and it supports discrete waveguide modes determined by its geometry and boundary conditions. In the parallel-plate structure, the TEM configuration can coexist with non-TEM modes produced by zig-zag plane-wave reflections. The TEM mode has no cutoff, but each higher-order mode has a cutoff frequency below which it cannot propagate. The number of supported modes increases with frequency and also depends on plate separation and the dielectric medium. Rectangular metallic waveguides support TE and TM modes but not TEM because their closed conducting boundary forces transverse field variation.

## Page-Grounded Details

#### Page 478

D13.4. A microstrip line is fabricated on a lithium niobate substrate ($\epsilon_{r}=4.8$) of 1 mm thickness. If the top conductor is 2 mm wide, find (a) $\epsilon_{r}$, eff; (b) $Z_{0}$; (c) $v_{p}$.

Ans. (a) 3.6; (b) 47 $\Omega$; (c) $1.6\times 10^{8}m/s$

#### 13.2 BASIC WAVEGUIDE OPERATION

Waveguides assume many different forms that depend on the purpose of the guide and on the frequency of the waves to be transmitted. The simplest form (in terms of analysis) is the parallel-plate guide shown in Figure 13.6. Other forms are the hollow-pipe guides, including the rectangular waveguide of Figure 13.7, and the cylindrical guide, shown in Figure 13.8. Dielectric waveguides, used primarily at optical frequencies, include the slab waveguide of Figure 13.9 and the optical fiber, shown in Figure 13.10. Each of these structures has certain advantages over the others, depending on the application and the frequency of the waves to be transmitted. All guides, however, exhibit the same basic operating principles, which we will explore in this section.

To develop an understanding of waveguide behavior, we consider the parallel-plate waveguide of Figure 13.6. At first, we recogn

[Truncated for analysis]

#### Page 479

Figure 13.7 Rectangular waveguide.

Figure 13.8 Cylindrical waveguide.

Figure 13.9 Symmetric dielectric slab waveguide, with slab region (refractive index $n_{1}$) surrounded by two dielectrics of index $n_{2}<n_{1}$.

#### Page 480

Figure 13.10 Optical fiber waveguide, with the core dielectric ($\rho < \alpha$) of refractive index $n_{1}$. The cladding dielectric ($\alpha < \rho < b$) is of index $n_{2} < n_{1}$.

this as a transmission-line wave, which, as discussed in Section 13.1, is a transverse electromagnetic, or TEM, wave. The wavevector $\mathbf{k}$, shown in Figure 13.1, indicates the direction of wave travel as well as the direction of power flow.

As the frequency is increased, a remarkable change occurs in the way the fields progagate down the line. Although the original field configuration of Figure 13.1 may still be present, another possibility emerges, which is shown in Figure 13.11. Again, a plane wave is guided in the $z$ direction, but by means of a progression of zig-zag reflections at the upper and lower plates. Wavevectors $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$ are associated with the upward-and downward-propagating waves, respectively, and these have identical magnitudes,
$$
|\mathbf{k}_{u}|=|\mathbf{k}_{d}|=k=\omega\sqrt{\mu\epsilon}
$$
For such a wave to propagate, all upward-propagating waves must be in phase (as must be true of all downward-propagating waves). This c

[Truncated for analysis]

#### Page 481

Figure 13.12 Plane wave representation of TE and TM modes in a parallel-plate guide.

If above cutoff, the mode propagates. The TEM mode, however, has no cutoff; it will be supported at any frequency. At a given frequency, the guide may support several modes, the quantity of which depends on the plate separation and on the dielectric constant of the interior medium, as will be shown. The number of modes increases as the frequency is raised.

So to answer our initial question on the distinction between transmission lines and waveguides, we can state the following: Transmission lines consist of two or more conductors and as a rule will support TEM waves (or something which could approximate such a wave). A waveguide may consist of one or more conductors, or no conductors at all, and will support waveguide modes of forms similar to those just described. Waveguides may or may not support TEM waves, depending on the design.

In the parallel-plate guide, two types of waveguide modes can be supported. These are shown in Figure 13.12 as arising from the s and p orientations of the plane wave polarizations. In a manner consistent with our previous discussions on oblique reflection (Section

[Truncated for analysis]

## Core Ideas

- TEM means both electric and magnetic fields are transverse to the propagation direction.
- Transmission lines generally require two or more conductors and support TEM or approximately TEM waves.
- Waveguides may have one, several, or no conductors.
- Waveguide modes are discrete field configurations fixed by geometry and boundary conditions.
- The parallel-plate guide supports TEM, TE, and TM propagation.
- The TEM mode has no cutoff frequency.
- Rectangular metallic waveguides do not support a TEM mode.

## Source Anchors

- Figure 13.6 defines a parallel-plate guide with conducting plates at $x=0$ and $x=d$ and dielectric permittivity $\epsilon$ between them.
- Figures 13.7 through 13.10 show rectangular, cylindrical, symmetric dielectric slab, and optical-fiber waveguides.
- Figure 13.10 identifies a core of index $n_1$ and cladding of lower index $n_2<n_1$.
- The text states that a TEM wave has both fields in the transverse plane and propagates in the direction indicated by $\mathbf{k}$.
- The text states that the number of modes increases as frequency rises.
- Page 495 explains that the completely surrounding boundary of a rectangular guide prevents a TEM field configuration.

## Related Pages

- [[plane-wave-model-of-guided-modes|Plane-Wave Model of Guided Modes]]
- [[te-and-tm-polarization-in-parallel-plate-guides|TE and TM Polarization in Parallel-Plate Guides]]
- [[rectangular-waveguide-geometry-and-absence-of-tem|Rectangular Waveguide Geometry and Absence of TEM]]

## Concept Dependencies

- related: [[plane-wave-model-of-guided-modes|Plane-Wave Model of Guided Modes]]
- part-of: [[te-and-tm-polarization-in-parallel-plate-guides|TE and TM Polarization in Parallel-Plate Guides]]
- contrasts-with: [[rectangular-waveguide-geometry-and-absence-of-tem|Rectangular Waveguide Geometry and Absence of TEM]]
