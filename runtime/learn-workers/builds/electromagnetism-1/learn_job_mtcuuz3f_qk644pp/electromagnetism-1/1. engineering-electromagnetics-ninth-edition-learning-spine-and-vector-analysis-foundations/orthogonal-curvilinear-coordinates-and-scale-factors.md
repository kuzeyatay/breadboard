---
title: "1.343 Orthogonal Curvilinear Coordinates and Scale Factors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 569, Section A.1", "Page 570, Section A.1"]
related: ["divergence-in-orthogonal-curvilinear-coordinates", "gradient-curl-and-laplacian-in-curvilinear-coordinates"]
---

# 1.343 Orthogonal Curvilinear Coordinates and Scale Factors

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 569, Section A.1, Page 570, Section A.1

A general orthogonal curvilinear coordinate system locates a point by the intersection of three mutually perpendicular surfaces $u=\text{constant}$, $v=\text{constant}$, and $w=\text{constant}$. Since coordinate increments need not have dimensions of length, each differential increment is multiplied by a scale factor. The differential side lengths are
$$
dL_1=h_1du,\qquad dL_2=h_2dv,\qquad dL_3=h_3dw
$$
 The scale factors $h_1$, $h_2$, and $h_3$ may depend on all three coordinates and convert parameter changes into physical distances. The differential volume is consequently $d\mathcal{V}=h_1h_2h_3\,du\,dv\,dw$. Rectangular coordinates use $(u,v,w)=(x,y,z)$ with all scale factors equal to 1. Cylindrical coordinates use $(\rho,\phi,z)$ with $(h_1,h_2,h_3)=(1,\rho,1)$. Spherical coordinates use $(r,\theta,\phi)$ with $(h_1,h_2,h_3)=(1,r,r\sin\theta)$. The coordinate ordering is selected so that $\mathbf{a}_u\times\mathbf{a}_v=\mathbf{a}_w$, providing a right-handed orthonormal basis for the operator formulas that follow.

## Page-Grounded Details

#### Page 569

### Vector Analysis

#### A.1 GENERAL CURVILINEAR COORDINATES

Let us consider a general orthogonal coordinate system in which a point is located by the intersection of three mutually perpendicular surfaces (of unspecified form or shape),
$$
\begin{array}{ll}u&=&\text{constant}\\v&=&\text{constant}\\w&=&\text{constant}\end{array}
$$
where $u$, $v$, and $w$ are the variables of the coordinate system. If each variable is increased by a differential amount and three more mutually perpendicular surfaces are drawn corresponding to these new values, a differential volume is formed which approximates a rectangular parallelepiped. Because $u$, $v$, and $w$ need not be measures of length, such as the angle variables of the cylindrical and spherical coordinate systems, each must be multiplied by a general function of $u$, $v$, and $w$ in order to obtain the differential sides of the parallelepiped. Thus we define the scale factors $h_{1}$, $h_{2}$, and $h_{3}$ each as a function of the three variables $u$, $v$, and $w$ and write the lengths of the sides of the differential volume as
$$
\begin{array}{ll}dL_{1}&=h_{1}du\\dL_{2}&=h_{2}dv\\dL_{3}&=h_{3}dw\end{arr

[Truncated for analysis]

#### Page 570

The choice of $u$, $v$, and $w$ has been made so that $\mathbf{a}_{u} \times \mathbf{a}_{v} = \mathbf{a}_{w}$ in all cases. More involved expressions for $h_{1}$, $h_{2}$, and $h_{3}$ are to be expected in other less familiar coordinate systems.$^{1}$

#### A.2 Divergence, Gradient, and Curl in General Curvilinear Coordinates

If the method used to develop divergence in Sections 3.4 and 3.5 is applied to the general curvilinear coordinate system, the flux of the vector $\mathbf{D}$ passing through the surface of the parallelepiped whose unit normal is $\mathbf{a}_{u}$ is
$$
 D_{u0} dL_{2} dL_{3} + \frac{1}{2} \frac{\partial}{\partial u} (D_{u} dL_{2} dL_{3}) du
$$
or
$$
 D_{u0} h_{2} h_{3} d v d w + \frac{1}{2} \frac{\partial}{\partial u} (D_{u} h_{2} h_{3} d v d w) d u
$$
and for the opposite face it is
$$
 -D_{u0} h_{2} h_{3} d v d w + \frac{1}{2} \frac{\partial}{\partial u} (D_{u} h_{2} h_{3} d v d w) d u
$$
giving a total for these two faces of
$$
 \frac{\partial}{\partial u} (D_{u} h_{2} h_{3} d v d w) d u
$$
Because $u$, $v$, and $w$ are independent variables, this last expression may be written as
$$
 \frac{\partial}{\partial u} (h_{2} h_{3} D_{

[Truncated for analysis]

## Core Ideas

- Coordinate surfaces $u$, $v$, and $w$ are mutually perpendicular.
- Physical differential lengths are $h_1du$, $h_2dv$, and $h_3dw$.
- Scale factors may depend on all three coordinates.
- The differential volume is $h_1h_2h_3\,du\,dv\,dw$.
- Cylindrical scale factors are $(1,\rho,1)$.
- Spherical scale factors are $(1,r,r\sin\theta)$.
- The basis is ordered so that $\mathbf{a}_u\times\mathbf{a}_v=\mathbf{a}_w$.

## Source Anchors

- Page 569 defines the coordinate surfaces $u=\mathrm{constant}$, $v=\mathrm{constant}$, and $w=\mathrm{constant}$.
- The differential lengths are defined as $dL_1=h_1du$, $dL_2=h_2dv$, and $dL_3=h_3dw$.
- Rectangular coordinates have $h_1=h_2=h_3=1$.
- Equation (A-1) gives cylindrical scale factors $1,\rho,1$.
- Spherical coordinates have scale factors $1,r,r\sin\theta$.
- Page 570 states $\mathbf{a}_u\times\mathbf{a}_v=\mathbf{a}_w$.

## Related Pages

- [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]
- [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]

## Concept Dependencies

- enables: [[divergence-in-orthogonal-curvilinear-coordinates|Divergence in Orthogonal Curvilinear Coordinates]]
- enables: [[gradient-curl-and-laplacian-in-curvilinear-coordinates|Gradient, Curl, and Laplacian in Curvilinear Coordinates]]
