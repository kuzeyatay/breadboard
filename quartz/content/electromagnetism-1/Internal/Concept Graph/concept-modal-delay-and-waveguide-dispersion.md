---
title: "Modal Delay and Waveguide Dispersion"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "modal-delay-and-waveguide-dispersion"
locations: ["Page 489, Example 13.3", "Page 490, Example 13.3 solution", "Page 493, Figure 13.17 and waveguide-dispersion discussion"]
related: ["phase-and-group-velocities-in-a-waveguide", "parallel-plate-wave-equation-eigenmodes", "counting-propagating-parallel-plate-modes"]
---

## ConceptNode: Modal Delay and Waveguide Dispersion

Planning node for [[modal-delay-and-waveguide-dispersion|1.277 Modal Delay and Waveguide Dispersion]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 489, Example 13.3, Page 490, Example 13.3 solution, Page 493, Figure 13.17 and waveguide-dispersion discussion

Different waveguide modes generally have different cutoff frequencies and therefore different group velocities at the same operating frequency. Energy distributed among those modes arrives at different times, causing modal dispersion and pulse broadening. Example 13.3 considers the Teflon-filled parallel-plate guide at $25\ \text{GHz}$, where the $m=1$ and $m=2$ modes are above cutoff. Their group velocities are calculated as $v_{g1}=0.63c$ and $v_{g2}=0.39c$. Over a distance of $1\ \text{cm}$, the delay difference is $$\Delta t=\left(\frac{1}{v_{g2}}-\frac{1}{v_{g1}}\right)(1\ \text{cm})=33\ \text{ps/cm}.$$ A pulse whose energy occupies both modes broadens by approximately this amount per centimeter. Including the cutoff-free TEM mode increases the relevant difference because its group velocity is $c/\sqrt{2.1}$. The delay between TEM and the $m=2$ mode becomes $52\ \text{ps/cm}$. Waveguide dispersion also exists within a single mode because its group velocity changes with frequency.

### Key planning details

- Modes with different cutoff frequencies have different group velocities.
- Differential modal delay causes pulse broadening.
- At 25 GHz, the example gives $v_{g1}=0.63c$.
- At 25 GHz, the example gives $v_{g2}=0.39c$.
- The $m=1$ to $m=2$ delay difference is $33\ \text{ps/cm}$.
- Including TEM increases the net example delay to $52\ \text{ps/cm}$.
- Frequency dependence of group velocity also produces intramodal waveguide dispersion.

### Source coverage

- Example 13.3 states that $m=1$ and $m=2$ are above cutoff at $25\ \text{GHz}$.
- The calculated group velocities are $0.63c$ and $0.39c$.
- The source obtains $\Delta t=3.3\times10^{-11}\ \text{s/cm}=33\ \text{ps/cm}$.
- The pulse example describes energy separation and broadening during propagation.
- Including TEM gives $\Delta t_{\text{net}}=52\ \text{ps/cm}$.
- Figure 13.17 and its discussion identify changing wave angle with frequency as the mechanism of waveguide dispersion.
