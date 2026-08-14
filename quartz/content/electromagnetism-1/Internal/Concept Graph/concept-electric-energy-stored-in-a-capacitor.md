---
title: "Electric Energy Stored in a Capacitor"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "electric-energy-stored-in-a-capacitor"
locations: ["Page 160", "Page 161", "Equation (4)", "Problem D6.1"]
related: ["parallel-plate-capacitance", "capacitance-as-a-charge-to-potential-ratio", "curved-dielectric-interface-field-tasks"]
---

## ConceptNode: Electric Energy Stored in a Capacitor

Planning node for [[electric-energy-stored-in-a-capacitor|1.80 Electric Energy Stored in a Capacitor]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 160, Page 161, Equation (4), Problem D6.1

The energy of a capacitor can be calculated by integrating electric-field energy density throughout the dielectric. For a homogeneous linear dielectric, the source uses $w_E=\tfrac12\epsilon E^2$. In the uniform field of a parallel-plate capacitor, integrating this density over volume $Sd$ gives a result that can be rewritten using $C=\epsilon S/d$, $V_0=Ed$, and $Q=CV_0$. The equivalent forms are $$W_E=\frac12CV_0^2=\frac12QV_0=\frac12\frac{Q^2}{C}.$$ Each form is useful under a different constraint. At fixed voltage, increasing capacitance increases stored energy. At fixed charge, increasing capacitance decreases stored energy. The source explicitly notes that when the potential difference is fixed, increasing the dielectric constant increases the stored energy because capacitance rises with permittivity. Diagnostic problem D6.1 reverses these formulas to infer relative permittivity from total energy, energy density, or the pair $E$ and $\rho_S$.

### Key planning details

- Electric energy density in a linear dielectric is $w_E=\tfrac12\epsilon E^2$.
- Total energy is obtained by integrating energy density over the dielectric volume.
- $W_E=\tfrac12CV_0^2$ is convenient when voltage is specified.
- $W_E=\tfrac12Q^2/C$ is convenient when charge is specified.
- At fixed voltage, higher permittivity increases stored energy.
- Energy measurements can be used to infer dielectric permittivity.

### Source coverage

- The source integrates $\tfrac12\epsilon E^2$ over the parallel-plate volume.
- Equation (4): $$W_E=\frac12CV_0^2=\frac12QV_0=\frac12\frac{Q^2}{C}.$$
- The text states that stored energy at fixed potential difference increases with dielectric constant.
- D6.1 asks for relative permittivity using total energy, energy density, and field plus surface charge data.
- D6.1 reports answers 1.05, 1.14, and 11.3.
