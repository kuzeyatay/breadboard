---
title: "1.258 Recursive Impedance Transformation in Multilayers"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 439", "Page 440", "Section 12.3.4: The Multilayer Problem: Impedance Transformation", "Exercise D12.3"]
related: ["finite-dielectric-slab-two-interface-system", "input-impedance-net-slab-reflection", "quarter-wave-matching-antireflection-coatings", "half-wave-matching"]
---

# 1.258 Recursive Impedance Transformation in Multilayers

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 439, Page 440, Section 12.3.4: The Multilayer Problem: Impedance Transformation, Exercise D12.3

The input-impedance method extends from one finite layer to any number of interfaces by working backward from the final medium. In the three-interface example, region 4 is first transformed through region 3 to produce an effective impedance at the boundary between regions 2 and 3. That transformed value is then treated as the termination for region 2 and transformed again to the front surface. Once the front input impedance is known, the entire multilayer structure is replaced by one effective load as seen from region 1, and the reflected fraction follows from the usual coefficient. The transmitted fraction is the remaining power for the lossless structure. This recursive process can be tedious by hand but is readily automated. Multiple gradually changing layers are valuable because they reduce sensitivity to wavelength. For a broadband lens coating, impedances can transition progressively from a value near the glass impedance toward the air impedance. In the ideal limiting picture of a continuous impedance variation, no abrupt reflecting surface exists. Figure 12.5 supplies the source-central diagram for this backward transformation procedure, while exercise D12.3 tests quarter-wave slab reflection.

## Page-Grounded Details

#### Page 439

Figure 12.5 A three-interface problem in which input impedance $\eta_{\mathrm{in,a}}$ is transformed back to the front interface to form input impedance $\eta_{\mathrm{in,b}}$.

#### 12.3.4 The Multilayer Problem: Impedance Transformation

The procedure for evaluating wave reflection from two interfaces has involved calcu-lating an effective impedance at the first interface, $\eta_{\mathrm{in}}$, which is expressed in terms of the impedances that lie beyond the front surface. This process of impedance trans-formation is more apparent when we consider problems involving more than two interfaces.

For example, consider the three-interface situation shown in Figure 12.5, where a wave is incident from the left in region 1. We wish to determine the fraction of the incident power that is reflected and back-propagates in region 1 and the fraction of the incident power that is transmitted into region 4. To do this, we need to find the input impedance at the front surface (the interface between regions 1 and 2). We start by transforming the impedance of region 4 to form the input impedance at the boundary between regions 2 and 3. This is shown as $\eta_{\mathrm{in,b}}$ in Figure 12.

[Truncated for analysis]

#### Page 440

The fraction of the power transmitted into region 4 is, as before, $1-\mid\Gamma\mid^{2}$. The method of impedance transformation can be applied in this manner to any number of interfaces. The process, although tedious, is easily handled by a computer.

The motivation for using multiple layers to reduce reflection is that the resulting structure is less sensitive to deviations from the design wavelength if the impedances (or refractive indices) are arranged to progressively increase or decrease from layer to layer. For multiple layers to antireflection coat a camera lens, for example, the layer on the lens surface would be of impedance very close to that of the glass. Subsequent layers are given progressively higher impedances. With a large number of layers fabricated in this way, the situation begins to approach (but never reaches) the ideal case, in which the top layer impedance matches that of air, while the impedances of deeper layers continuously decrease until reaching the value of the glass surface. With this continuously varying impedance, there is no surface from which to reflect, and so light of any wavelength is totally transmitted. Multilayer coatings designed in this

[Truncated for analysis]

## Core Ideas

- Multilayer analysis starts at the last medium and proceeds toward the incident medium.
- Each finite layer transforms the impedance of everything behind it.
- The transformed impedance becomes the load for the preceding layer.
- The final reflection coefficient uses the effective impedance at the front surface.
- For lossless layers, transmitted power is $1-|\Gamma|^2$.
- Progressive impedance changes improve broadband transmission.
- The recursive calculation is well suited to computer implementation.

## Source Anchors

- Figure S1.P439.F1, corresponding to Figure 12.5, shows $\eta_{\mathrm{in},b}$ transformed back to form $\eta_{\mathrm{in},a}$.
- Equation (47) transforms $\eta_4$ through region 3 to obtain $\eta_{\mathrm{in},b}$.
- Equation (48) transforms $\eta_{\mathrm{in},b}$ through region 2 to obtain $\eta_{\mathrm{in},a}$.
- The front reflection coefficient is
$$
\Gamma=\frac{\eta_{\mathrm{in},a}-\eta_1}{\eta_{\mathrm{in},a}+\eta_1}
$$
- Page 440 states that the method applies to any number of interfaces and is easily handled by a computer.
- Page 440 explains that progressively graded layer impedances produce broadband antireflection behavior.
- Exercise D12.3 gives a quarter-wave air-slab problem with $\eta_2=260\ \Omega$ and answer $|\Gamma|=0.356$ at phase $180^\circ$.

## Related Pages

- [[finite-dielectric-slab-two-interface-system|Finite Dielectric Slab as a Two-Interface System]]
- [[input-impedance-net-slab-reflection|Input Impedance and Net Slab Reflection]]
- [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]
- [[half-wave-matching|Half-Wave Matching]]

## Concept Dependencies

- depends-on: [[input-impedance-net-slab-reflection|Input Impedance and Net Slab Reflection]]
