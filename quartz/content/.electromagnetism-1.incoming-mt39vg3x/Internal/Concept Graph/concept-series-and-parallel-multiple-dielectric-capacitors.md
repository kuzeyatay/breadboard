---
title: "Series and Parallel Multiple-Dielectric Capacitors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "series-and-parallel-multiple-dielectric-capacitors"
locations: ["Page 162", "Page 163", "Page 164", "Section 6.3.3: Capacitors with Multiple Dielectrics", "Figure 6.3"]
related: ["refraction-of-fields-at-a-dielectric-boundary", "parallel-plate-capacitance", "coaxial-and-spherical-capacitor-geometries"]
---

## ConceptNode: Series and Parallel Multiple-Dielectric Capacitors

Planning node for [[series-and-parallel-multiple-dielectric-capacitors|1.82 Series and Parallel Multiple-Dielectric Capacitors]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 162, Page 163, Page 164, Section 6.3.3: Capacitors with Multiple Dielectrics, Figure 6.3

Multiple dielectric regions alter capacitance according to how their interfaces are oriented relative to the electric field. For a coated isolated sphere, spherical symmetry leaves $D_r=Q/(4\pi r^2)$ unchanged across the dielectric boundary, while $E_r=D_r/\epsilon$ changes by region. The total voltage is the sum of radial line integrals through each material. For a parallel-plate capacitor whose dielectric interface is parallel to the plates, the field is normal to the interface and $D_N$ is continuous. Each layer contributes a voltage drop $V_i=Qd_i/(\epsilon_iS)$, producing $$C=\frac{1}{d_1/(\epsilon_1S)+d_2/(\epsilon_2S)},$$ equivalent to capacitors in series. If the dielectric boundary is normal to the plates, both regions share the same voltage and tangential electric field. Their charges add, giving $$C=\frac{\epsilon_1S_1+\epsilon_2S_2}{d}=C_1+C_2.$$ The source also states that inserting a negligible-thickness conducting plane at a parallel dielectric interface leaves capacitance unchanged, while replacing a finite dielectric volume with a conductor increases capacitance.

### Key planning details

- Layered dielectrics along the field direction behave as series capacitors.
- Side-by-side dielectrics transverse to the field direction behave as parallel capacitors.
- Normal $\mathbf D$ continuity controls the series-layer derivation.
- Tangential $\mathbf E$ continuity controls the side-by-side derivation.
- Voltage drops add through serial dielectric layers.
- Replacing dielectric volume with a conducting body increases capacitance.

### Source coverage

- The coated-sphere example uses $D_r=Q/(4\pi r^2)$ in both dielectric regions.
- The coated-sphere voltage contains separate integrals weighted by $1/\epsilon_1$ and $1/\epsilon_0$.
- Figure 6.3 shows a parallel-plate capacitor whose dielectric interface is parallel to the plates.
- Equation (9): $$C=\frac{1}{d_1/(\epsilon_1S)+d_2/(\epsilon_2S)}.$$
- Equation (10): $$C=(\epsilon_1S_1+\epsilon_2S_2)/d=C_1+C_2.$$
- Visual opportunity S1.P162.F1: recreate Figure 6.3 with field, layer thicknesses, voltage drops, and the equivalent series circuit.
