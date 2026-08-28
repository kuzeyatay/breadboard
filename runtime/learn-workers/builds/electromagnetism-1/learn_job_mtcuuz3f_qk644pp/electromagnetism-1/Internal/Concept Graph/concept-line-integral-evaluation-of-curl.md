---
title: "Line-Integral Evaluation of Curl"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "line-integral-evaluation-of-curl"
locations: ["Page 214", "Page 215", "Example 7.2", "Figure S1.P214.F1"]
related: ["curl-circulation-per-unit-area", "coordinate-formulas-for-curl", "point-form-of-amperes-law"]
---

## ConceptNode: Line-Integral Evaluation of Curl

Planning node for [[line-integral-evaluation-of-curl|1.115 Line-Integral Evaluation of Curl]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 214, Page 215, Example 7.2, Figure S1.P214.F1

Example 7.2 demonstrates that curl can be calculated either from its limiting circulation definition or by direct differentiation. The field is $\mathbf{H}=0.2z^2\mathbf{a}_x$ for $z>0$ and zero elsewhere. A square of side $d$, centered at $(0,0,z_1)$ in the $y=0$ plane with $z_1>d/2$, has two sides parallel to the field and two perpendicular to it. Evaluating the four path contributions gives

$$\oint\mathbf{H}\cdot d\mathbf{L}=0.4z_1d^2.$$

Dividing by the area $d^2$ and taking $d\to0$ yields

$$(\nabla\times\mathbf{H})_y=0.4z_1.$$

Direct use of the rectangular curl formula gives $\nabla\times\mathbf{H}=0.4z\mathbf{a}_y$, which agrees at $z=z_1$. The example clarifies that finite circulation may be evaluated from path segments, while curl is the limiting circulation density at the point enclosed by a shrinking path.

### Key planning details

- Only path segments parallel to the field contribute to the line integral.
- Opposite parallel sides sample the field at different $z$ values.
- The circulation is $0.4z_1d^2$.
- Dividing by area gives the local curl component in the limit.
- The circulation orientation selects the positive $y$ normal.
- Direct differentiation gives $\nabla\times\mathbf{H}=0.4z\mathbf{a}_y$.
- The definition-based and derivative-based methods agree.

### Source coverage

- Figure S1.P214.F1 shows the square path centered at $z=z_1$ in the $y=0$ plane.
- Pages 214-215 specify $\mathbf{H}=0.2z^2\mathbf{a}_x$ for $z>0$.
- Page 215 evaluates the four path contributions and obtains $0.4z_1d^2$.
- Page 215 divides by $d^2$ and takes the zero-size limit.
- Page 215 evaluates the rectangular determinant and obtains $0.4z\mathbf{a}_y$.
