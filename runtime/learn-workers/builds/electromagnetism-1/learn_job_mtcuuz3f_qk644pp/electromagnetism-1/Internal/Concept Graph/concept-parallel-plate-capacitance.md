---
title: "Parallel-Plate Capacitance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "parallel-plate-capacitance"
locations: ["Page 159", "Page 160", "Section 6.2: Parallel-Plate Capacitor", "Example 6.1", "Figure 6.2"]
related: ["capacitance-as-a-charge-to-potential-ratio", "electric-energy-stored-in-a-capacitor", "series-and-parallel-multiple-dielectric-capacitors"]
---

## ConceptNode: Parallel-Plate Capacitance

Planning node for [[parallel-plate-capacitance|1.79 Parallel-Plate Capacitance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 159, Page 160, Section 6.2: Parallel-Plate Capacitor, Example 6.1, Figure 6.2

For parallel conducting plates separated by distance $d$ in a homogeneous dielectric of permittivity $\epsilon$, equal and opposite surface charge densities produce an approximately uniform field away from the edges. The conductor boundary condition gives $\mathbf D=\rho_S\mathbf a_z$, and the constitutive relation gives $\mathbf E=(\rho_S/\epsilon)\mathbf a_z$. Integrating the electric field between the plates yields $V_0=\rho_Sd/\epsilon$. For finite plates of area $S$ whose lateral dimensions greatly exceed $d$, edge effects occupy only a small part of the field region. With $Q=\rho_SS$, substitution into $C=Q/V_0$ gives $$C=\frac{\epsilon S}{d}.$$ The formula shows that capacitance increases with plate area and dielectric permittivity and decreases with plate separation. Example 6.1 applies the formula to mica with $\epsilon_r=6$, area $10$ in.$^2$, and spacing $0.01$ in., obtaining $1.349$ nF after unit conversion. Practical capacitors increase effective area by stacking or rolling conductors separated by thin dielectric layers.

### Key planning details

- The ideal parallel-plate field is uniform and normal to both plates.
- $\mathbf D=\rho_S\mathbf a_z$ follows from the conductor boundary condition.
- $V_0=\rho_Sd/\epsilon$ follows from integrating the field.
- The finite-plate approximation is valid when lateral dimensions greatly exceed $d$.
- The capacitance is $C=\epsilon S/d$.
- Stacked and rolled constructions increase effective plate area.

### Source coverage

- Figure 6.2 shows plates at $z=0$ and $z=d$ with opposite surface charge densities.
- The source derives $\mathbf E=(\rho_S/\epsilon)\mathbf a_z$ and $\mathbf D=\rho_S\mathbf a_z$.
- Equation (3) gives $Q=\rho_SS$ and $V_0=(\rho_S/\epsilon)d$.
- Example 6.1 converts $10$ in.$^2$ to $6.45\times10^{-3}$ m$^2$ and $0.01$ in. to $2.54\times10^{-4}$ m.
- Example 6.1 obtains $C=1.349$ nF.
- Visual opportunity S1.P159.F1: recreate Figure 6.2 with normals, surface charges, field direction, and adjustable $S$, $d$, and $\epsilon$.
