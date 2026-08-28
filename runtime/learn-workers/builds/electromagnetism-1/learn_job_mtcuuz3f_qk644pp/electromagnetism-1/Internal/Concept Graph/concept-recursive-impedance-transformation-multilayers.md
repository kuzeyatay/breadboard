---
title: "Recursive Impedance Transformation in Multilayers"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "recursive-impedance-transformation-multilayers"
locations: ["Page 439", "Page 440", "Section 12.3.4: The Multilayer Problem: Impedance Transformation", "Exercise D12.3"]
related: ["finite-dielectric-slab-two-interface-system", "input-impedance-net-slab-reflection", "quarter-wave-matching-antireflection-coatings", "half-wave-matching"]
---

## ConceptNode: Recursive Impedance Transformation in Multilayers

Planning node for [[recursive-impedance-transformation-multilayers|1.258 Recursive Impedance Transformation in Multilayers]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 439, Page 440, Section 12.3.4: The Multilayer Problem: Impedance Transformation, Exercise D12.3

The input-impedance method extends from one finite layer to any number of interfaces by working backward from the final medium. In the three-interface example, region 4 is first transformed through region 3 to produce an effective impedance at the boundary between regions 2 and 3. That transformed value is then treated as the termination for region 2 and transformed again to the front surface. Once the front input impedance is known, the entire multilayer structure is replaced by one effective load as seen from region 1, and the reflected fraction follows from the usual coefficient. The transmitted fraction is the remaining power for the lossless structure. This recursive process can be tedious by hand but is readily automated. Multiple gradually changing layers are valuable because they reduce sensitivity to wavelength. For a broadband lens coating, impedances can transition progressively from a value near the glass impedance toward the air impedance. In the ideal limiting picture of a continuous impedance variation, no abrupt reflecting surface exists. Figure 12.5 supplies the source-central diagram for this backward transformation procedure, while exercise D12.3 tests quarter-wave slab reflection.

### Key planning details

- Multilayer analysis starts at the last medium and proceeds toward the incident medium.
- Each finite layer transforms the impedance of everything behind it.
- The transformed impedance becomes the load for the preceding layer.
- The final reflection coefficient uses the effective impedance at the front surface.
- For lossless layers, transmitted power is $1-|\Gamma|^2$.
- Progressive impedance changes improve broadband transmission.
- The recursive calculation is well suited to computer implementation.

### Source coverage

- Figure S1.P439.F1, corresponding to Figure 12.5, shows $\eta_{\mathrm{in},b}$ transformed back to form $\eta_{\mathrm{in},a}$.
- Equation (47) transforms $\eta_4$ through region 3 to obtain $\eta_{\mathrm{in},b}$.
- Equation (48) transforms $\eta_{\mathrm{in},b}$ through region 2 to obtain $\eta_{\mathrm{in},a}$.
- The front reflection coefficient is $$\Gamma=\frac{\eta_{\mathrm{in},a}-\eta_1}{\eta_{\mathrm{in},a}+\eta_1}.$$
- Page 440 states that the method applies to any number of interfaces and is easily handled by a computer.
- Page 440 explains that progressively graded layer impedances produce broadband antireflection behavior.
- Exercise D12.3 gives a quarter-wave air-slab problem with $\eta_2=260\ \Omega$ and answer $|\Gamma|=0.356$ at phase $180^\circ$.
