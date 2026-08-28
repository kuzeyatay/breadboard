---
title: "1.48 Streamline Differential Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 55", "Page 56", "Section: 2.6 Streamlines and Sketches of Fields"]
related: ["streamline-representation-of-electric-fields", "derivation-and-distance-scaling-of-the-infinite-line-field", "multipoles-finite-charge-distributions-and-far-field-limits"]
---

# 1.48 Streamline Differential Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 55, Page 56, Section: 2.6 Streamlines and Sketches of Fields

For a two-dimensional field with $E_z=0$, a streamline has a tangent direction proportional to the local field vector. If a small displacement along the curve is $d\mathbf{l}=dx\mathbf{a}_x+dy\mathbf{a}_y$, matching its slope to the field components gives $dy/dx=E_y/E_x$. Substituting the functional forms of $E_x$ and $E_y$ produces a first-order differential equation whose solution is a family of streamlines. For a normalized infinite-line field, conversion from cylindrical to rectangular components gives $E_x=x/(x^2+y^2)$ and $E_y=y/(x^2+y^2)$. The common denominator cancels, leaving $dy/dx=y/x$, whose solution is $y=Cx$. A particular point determines the constant $C$. Thus the radial-line sketch is recovered analytically rather than inferred only by inspection.

## Page-Grounded Details

#### Page 55

We will find out later that a bonus accompanies this streamline sketch, for the magnitude of the field can be shown to be inversely proportional to the spacing of the streamlines for some important special cases. The closer they are together, the stronger is the field. At that time we will also find an easier, more accurate method of making that type of streamline sketch.

If we tried to sketch the field of the point charge, the variation of the field into and away from the page would cause essentially insurmountable difficulties; for this reason sketching is usually limited to two-dimensional fields.

In the case of the two-dimensional field, we may arbitrarily set $E_{z}=0$. The streamlines are thus confined to planes for which $z$ is constant, and the sketch is the same for any such plane. Several streamlines are shown in Figure 2.10, and the $E_{x}$ and $E_{y}$ components are indicated at a general point. It is apparent from the geometry that
$$
\frac{E_{y}}{E_{x}}=\frac{dy}{dx}\quad{(19)}
$$
A knowledge of the functional form of $E_{x}$ and $E_{y}$ (and the ability to solve the resultant differential equation) will enable us to obtain the equations of the streaml

[Truncated for analysis]

#### Page 56

Therefore,
$$
\ln y=\ln x+C_{1}\qquad\text{or}\qquad\ln y=\ln x+\ln C
$$
)

from which the equations of the streamlines are obtained,
$$
y=Cx
$$
If we want to find the equation of one particular streamline, say one passing through $P(-2,7,10)$, we merely substitute the coordinates of that point into our equation and evaluate C. Here, $7=C(-2)$, and $C=-3.5$, so $y=-3.5x$.

Each streamline is associated with a specific value of C, and the radial lines shown in Figure 2.9$d$ are obtained when $C=0$, 1, $-1$, and $1/C=0$.

The equations of streamlines may also be obtained directly in cylindrical or spheri-cal coordinates. A spherical coordinate example will be examined in Section 4.7.

D2.7. Find the equation of the streamline that passes through the point $P(1$, 4, $-2)$ in the field
$$
E=(a)\frac{-8x}{y}a_{x}+\frac{4x^{2}}{y^{2}}a_{y};(b)\ 2e^{5x}[y(5x+1)a_{x}+xa_{y}]
$$
Ans. $(a)\,x^{2}+2y^{2}=33$; $(b)\,y^{2}=15.7+0.4x-0.08\ln(5x+1)$

#### REFERENCES

1.Boast, W. B. Vector Fields. New York: Harper and Row, 1964. This book contains many examples and sketches of fields.

2.Della Torre, E., and Longo, C. L. The Electromagnetic Field. Boston: Allyn and Bac

[Truncated for analysis]

## Core Ideas

- A streamline's tangent is parallel to the local field.
- For a two-dimensional rectangular field, $dy/dx=E_y/E_x$.
- The field components determine a family of integral curves.
- A specified point selects one member of the family.
- For an infinite line charge, the streamline family is $y=Cx$.
- Equivalent streamline equations can be formulated in cylindrical or spherical coordinates.

## Source Anchors

- Equation (19):
$$
\frac{E_y}{E_x}=\frac{dy}{dx}
$$
- Source figure S1.P55.F1, Figure 2.10, shows $E_x$, $E_y$, and the tangent to a streamline.
- For $\rho_L=2\pi\epsilon_0$, the field is $\mathbf{E}=\mathbf{a}_\rho/\rho$.
- In rectangular coordinates,
$$
\mathbf{E}=\frac{x}{x^2+y^2}\mathbf{a}_x+\frac{y}{x^2+y^2}\mathbf{a}_y
$$
- Integration gives $\ln y=\ln x+C_1$ and hence $y=Cx$.
- The streamline through $P(-2,7,10)$ has $C=-3.5$ and equation $y=-3.5x$.
- Drill D2.7 provides two additional fields whose streamline equations must be found.

## Related Pages

- [[streamline-representation-of-electric-fields|Streamline Representation of Electric Fields]]
- [[derivation-and-distance-scaling-of-the-infinite-line-field|Derivation and Distance Scaling of the Infinite-Line Field]]
- [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]

## Concept Dependencies

- depends-on: [[streamline-representation-of-electric-fields|Streamline Representation of Electric Fields]]
- applies-to: [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]
