---
title: "Cylinder-to-Plane Capacitance by Equivalent Line Charges"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "cylinder-to-plane-capacitance-by-equivalent-line-charges"
locations: ["Page 164", "Page 165", "Page 166", "Page 167", "Section 6.4: Capacitance of a Two-Wire Line", "Figures 6.4 and 6.5"]
related: ["image-methods-for-conducting-boundaries", "two-wire-line-field-and-surface-charge", "capacitance-as-a-charge-to-potential-ratio"]
---

## ConceptNode: Cylinder-to-Plane Capacitance by Equivalent Line Charges

Planning node for [[cylinder-to-plane-capacitance-by-equivalent-line-charges|1.83 Cylinder-to-Plane Capacitance by Equivalent Line Charges]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 164, Page 165, Page 166, Page 167, Section 6.4: Capacitance of a Two-Wire Line, Figures 6.4 and 6.5

The cylinder-to-plane problem is solved by recognizing that the equipotential surfaces of two equal and opposite infinite line charges are circular cylinders. With line charges at $x=\pm a$, the combined potential is $$V=\frac{\rho_L}{4\pi\epsilon}\ln\frac{(x+a)^2+y^2}{(x-a)^2+y^2}.$$ Setting $V=V_1$ and defining $K_1=e^{4\pi\epsilon V_1/\rho_L}$ converts the equipotential equation into a circle. Its radius and center are $b=2a\sqrt{K_1}/(K_1-1)$ and $h=a(K_1+1)/(K_1-1)$. Inverting these relations gives $a=\sqrt{h^2-b^2}$ and $\sqrt{K_1}=(h+\sqrt{h^2-b^2})/b$. A conducting cylinder of radius $b$ centered a distance $h$ from a grounded plane therefore has $$C=\frac{2\pi\epsilon L}{\cosh^{-1}(h/b)}.$$ The numerical example with $b=5$ m, $h=13$ m, and $V_0=100$ V obtains $a=12$ m, $K_1=25$, $\rho_L=3.46$ nC/m, and $C=34.6$ pF/m.

### Key planning details

- Opposite line charges generate circular cylindrical equipotential surfaces.
- The plane $x=0$ is the zero-potential symmetry plane.
- Completing the square identifies each equipotential circle's center and radius.
- The equivalent line-charge position is $a=\sqrt{h^2-b^2}$.
- Cylinder-to-plane capacitance is expressed using $\cosh^{-1}(h/b)$.
- The method replaces a conductor geometry with an equivalent source configuration.

### Source coverage

- Equation (11) gives the potential of opposite line charges at $x=\pm a$.
- Figure 6.4 labels distances $R_1$ and $R_2$ and shows circular cylindrical equipotentials.
- Equations for the equipotential circle give $b=2a\sqrt{K_1}/(K_1-1)$ and $h=a(K_1+1)/(K_1-1)$.
- The capacitance is $C=2\pi\epsilon L/\cosh^{-1}(h/b)$.
- The worked example obtains $34.6$ pF/m for a 5 m radius cylinder centered 13 m from the plane.
- Visual opportunities S1.P165.F1 and S1.P167.F1: recreate Figures 6.4 and 6.5 with line charges, equipotential cylinders, and adjustable geometry.
