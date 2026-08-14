---
title: "Quarter-Wave Matching and Antireflection Coatings"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "quarter-wave-matching-antireflection-coatings"
locations: ["Page 438", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers", "Example 12.5"]
related: ["input-impedance-net-slab-reflection", "refractive-index-material-wave-parameters", "half-wave-matching", "recursive-impedance-transformation-multilayers"]
---

## ConceptNode: Quarter-Wave Matching and Antireflection Coatings

Planning node for [[quarter-wave-matching-antireflection-coatings|1.257 Quarter-Wave Matching and Antireflection Coatings]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 438, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers, Example 12.5

Quarter-wave matching removes the restriction that the incident and exit media have equal impedances. The matching layer is assigned an odd-quarter-wave thickness, $l=(2m-1)\lambda_2/4$, so its phase thickness is $(2m-1)\pi/2$. Under this condition, the layer transforms the terminating impedance according to $\eta_{\mathrm{in}}=\eta_2^2/\eta_3$. Requiring zero reflection means setting $\eta_{\mathrm{in}}=\eta_1$, which leads to the geometric-mean design rule $\eta_2=\sqrt{\eta_1\eta_3}$. Thus the coating impedance lies between the impedances of the two surrounding media. The minimum physical thickness uses $m=1$ and equals one quarter of the wavelength inside the coating, not one quarter of the free-space wavelength. Example 12.5 designs a coating between air and glass at 570 nm. With $n_3=1.45$, the glass impedance is about $260\ \Omega$, the required coating impedance is $313\ \Omega$, and the corresponding coating index is 1.20. The wavelength in the coating is 475 nm, giving a minimum thickness of 119 nm.

### Key planning details

- The odd-quarter-wave condition is $\beta_2l=(2m-1)\pi/2$.
- The corresponding thickness is $l=(2m-1)\lambda_2/4$.
- An odd-quarter-wave layer transforms the load to $\eta_{\mathrm{in}}=\eta_2^2/\eta_3$.
- Zero reflection requires $\eta_2=\sqrt{\eta_1\eta_3}$.
- The minimum coating thickness is $\lambda_2/4$.
- The wavelength used for thickness is measured inside the coating.
- Quarter-wave matching is the basis of optical antireflection coatings.

### Source coverage

- Equation (44) gives $$l=(2m-1)\frac{\lambda_2}{4}.$$
- Equation (45) gives $\eta_{\mathrm{in}}=\eta_2^2/\eta_3$.
- Equation (46) gives $$\eta_2=\sqrt{\eta_1\eta_3}.$$
- Example 12.5 uses $\eta_1=377\ \Omega$ and $\eta_3=377/1.45=260\ \Omega$.
- The example finds $\eta_2=313\ \Omega$ and $n_2=377/313=1.20$.
- For a 570 nm free-space wavelength, the example obtains $\lambda_2=475$ nm and $l=119$ nm.
