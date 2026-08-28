---
title: "1.126 Ferromagnetic Magnetization and Hysteresis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 272", "Page 273", "Section 8.8", "Figure 8.11", "Figure 8.12"]
related: ["classification-of-magnetic-materials", "anisotropic-and-nonlinear-magnetic-media", "nonlinear-gapped-magnetic-circuit-analysis"]
---

# 1.126 Ferromagnetic Magnetization and Hysteresis

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 272, Page 273, Section 8.8, Figure 8.11, Figure 8.12

Ferromagnetic materials do not generally follow a single linear relationship between $B$ and $H$. Starting from a fully demagnetized state, the virgin magnetization curve initially rises from the origin, then changes slope, and eventually approaches saturation. For the silicon sheet steel shown in Figure 8.11, the rise becomes slower after $H$ reaches roughly 100 A-turn/m, and saturation begins when $H$ reaches several hundred A-turn/m. If $H$ is reduced after partial saturation, the material does not retrace the original curve. When $H$ reaches zero, a remnant flux density $B_r$ remains. A reversed field of magnitude $H_c$, called the coercive force, is required to bring $B$ back to zero. Repeated cycling produces the closed hysteresis loop shown in Figure 8.12. Smaller maximum excursions of $H$ produce smaller internal loops, whose tips lie approximately along the virgin magnetization curve. These behaviors explain why ferromagnetic magnetic circuits often require graph-based, iterative, or piecewise-linear calculations instead of a constant permeability.

## Page-Grounded Details

#### Page 272

and obtain
$$
H_{\phi}=\frac{NI}{2\pi r}=\frac{500\times 4}{6.28\times 0.15}=2120\,\mathrm{A/m}
$$
at the mean radius.

Our magnetic circuit in this example does not give us any opportunity to find the mmf across different elements in the circuit, for there is only one type of material. The analogous electric circuit is, of course, a single source and a single resistor. We could make it look just as long as the preceding analysis, however, if we found the current density, the electric field intensity, the total current, the resistance, and the source voltage.

More interesting and more practical problems arise when ferromagnetic materials are present in the circuit. We begin by considering the relationship between B and H in such a material. We may assume that we are establishing a curve of B versus H for a sample of ferromagnetic material which is completely demagnetized; both B and H are zero. As we begin to apply an mmf, the flux density also rises, but not linearly, as the experimental data of Figure 8.11 show near the origin. After H reaches a value of about 100 A*t/m, the flux density rises more slowly and begins to saturate when H is several hundred A*t/m. Having reached p

[Truncated for analysis]

#### Page 273

Figure 8.12 A hysteresis loop for silicon steel. The coercive force $H_{c}$ and remnant flux density $B_{r}$ are indicated.

hysteresis loops are obtained, and the locus of the tips is about the same as the virgin magnetization curve of Figure 8.11.

#### EXAMPLE 8.7

We may use the magnetization curve for silicon steel to solve a magnetic circuit problem that is slightly different from our previous example. We use a steel core in the toroid, except for an air gap of 2 mm. Magnetic circuits with air gaps occur because gaps are deliberately introduced in some devices, such as inductors, which must carry large direct currents, because they are unavoidable in other devices such as rotating machines, or because of unavoidable problems in assembly. There are still 500 turns about the toroid, and we ask what current is required to establish a flux density of 1 T everywhere in the core.

**Solution.** This magnetic circuit is analogous to an electric circuit containing a voltage source and two resistors, one of which is nonlinear. Because we are given the "current," it is easy to find the "voltage" across each series element, and hence the total "emf." In the air gap,
$$ \begin{split

[Truncated for analysis]

## Core Ideas

- The virgin magnetization curve begins from the demagnetized state $B=H=0$.
- Ferromagnetic $B$ does not rise linearly with $H$.
- Saturation occurs when further increases in $H$ produce relatively small increases in $B$.
- Reducing $H$ does not retrace the virgin curve.
- The remnant flux density $B_r$ remains when $H$ returns to zero.
- The coercive force $H_c$ is the reversed field required to reduce $B$ to zero.
- Repeated field cycling produces a hysteresis loop.
- Smaller field cycles produce smaller loops within the major loop.

## Source Anchors

- Figure S13.P272.F8.11 is the magnetization curve of a silicon sheet-steel sample.
- The source reports a change in behavior near $H=100$ A-turn/m and saturation beginning at several hundred A-turn/m.
- Figure S13.P273.F8.12 labels remnant flux density $B_r$ and coercive force $H_c$ on the silicon-steel hysteresis loop.
- The locus of the tips of smaller hysteresis loops is described as approximately following the virgin magnetization curve.
- The nonlinear curve is used directly in Example 8.7 to determine the steel field intensity required for a specified flux density.

## Related Pages

- [[classification-of-magnetic-materials|Classification of Magnetic Materials]]
- [[anisotropic-and-nonlinear-magnetic-media|Anisotropic and Nonlinear Magnetic Media]]
- [[nonlinear-gapped-magnetic-circuit-analysis|Nonlinear Gapped Magnetic Circuit Analysis]]

## Concept Dependencies

- example-of: [[anisotropic-and-nonlinear-magnetic-media|Anisotropic and Nonlinear Magnetic Media]]
