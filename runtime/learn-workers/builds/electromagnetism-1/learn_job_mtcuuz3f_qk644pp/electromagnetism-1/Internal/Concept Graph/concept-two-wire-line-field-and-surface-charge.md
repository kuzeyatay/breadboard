---
title: "Two-Wire Line Field and Surface Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "two-wire-line-field-and-surface-charge"
locations: ["Page 167", "Page 168", "Section 6.4: Capacitance of a Two-Wire Line", "Problem D6.3"]
related: ["cylinder-to-plane-capacitance-by-equivalent-line-charges", "field-sketching-rules-for-two-dimensional-capacitance", "capacitance-as-a-charge-to-potential-ratio"]
---

## ConceptNode: Two-Wire Line Field and Surface Charge

Planning node for [[two-wire-line-field-and-surface-charge|1.84 Two-Wire Line Field and Surface Charge]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 167, Page 168, Section 6.4: Capacitance of a Two-Wire Line, Problem D6.3

Once the potential of the equivalent opposite line charges is known, the electric field is obtained from $\mathbf E=-\nabla V$, and $\mathbf D=\epsilon\mathbf E$. Evaluating the normal component of $\mathbf D$ at a conductor surface gives the local surface charge density. In the cylinder-to-plane example, the surface charge is largest on the side nearest the plane and smallest on the far side. The source calculates $\rho_{S,\max}=0.165$ nC/m$^2$ and $\rho_{S,\min}=0.073$ nC/m$^2$, a ratio of $2.25$. When the cylinder radius is much smaller than its distance from the plane, $b\ll h$, the exact logarithmic expression reduces to $$C\approx\frac{2\pi\epsilon L}{\ln(2h/b)}.$$ The capacitance between two identical circular conductors separated by $2h$ is one-half of the corresponding cylinder-to-plane capacitance. This connects the image-style cylinder-plane solution to the capacitance of a practical two-wire transmission line.

### Key planning details

- The field is found by taking the negative gradient of the potential.
- Surface charge density equals the appropriate normal component of $\mathbf D$.
- Charge density is nonuniform around the cylinder.
- The nearest point to the plane has the maximum surface charge density.
- For $b\ll h$, the capacitance denominator becomes $\ln(2h/b)$.
- Two-wire capacitance is one-half of the corresponding cylinder-to-plane value.

### Source coverage

- Pages 167 and 168 provide explicit rectangular-component formulas for $\mathbf E$ and $\mathbf D$.
- The example gives $\rho_{S,\max}=0.165$ nC/m$^2$.
- The example gives $\rho_{S,\min}=0.073$ nC/m$^2$.
- The calculated ratio is $\rho_{S,\max}=2.25\rho_{S,\min}$.
- Equation (17): $C=2\pi\epsilon L/\ln(2h/b)$ for $b\ll h$.
- Problem D6.3 reports $109.2$ pF/m and $42.6$ nC/m$^2$ for a specified dielectric cylinder-plane geometry.
