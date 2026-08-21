---
title: "Orthogonal Curvilinear Coordinates and Scale Factors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "orthogonal-curvilinear-coordinates-and-scale-factors"
locations: ["Page 569, Section A.1", "Page 570, Section A.1"]
related: ["divergence-in-orthogonal-curvilinear-coordinates", "gradient-curl-and-laplacian-in-curvilinear-coordinates"]
---

## ConceptNode: Orthogonal Curvilinear Coordinates and Scale Factors

Planning node for [[orthogonal-curvilinear-coordinates-and-scale-factors|1.343 Orthogonal Curvilinear Coordinates and Scale Factors]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 569, Section A.1, Page 570, Section A.1

A general orthogonal curvilinear coordinate system locates a point by the intersection of three mutually perpendicular surfaces $u=\text{constant}$, $v=\text{constant}$, and $w=\text{constant}$. Since coordinate increments need not have dimensions of length, each differential increment is multiplied by a scale factor. The differential side lengths are $$dL_1=h_1du,\qquad dL_2=h_2dv,\qquad dL_3=h_3dw.$$ The scale factors $h_1$, $h_2$, and $h_3$ may depend on all three coordinates and convert parameter changes into physical distances. The differential volume is consequently $d\mathcal{V}=h_1h_2h_3\,du\,dv\,dw$. Rectangular coordinates use $(u,v,w)=(x,y,z)$ with all scale factors equal to 1. Cylindrical coordinates use $(\rho,\phi,z)$ with $(h_1,h_2,h_3)=(1,\rho,1)$. Spherical coordinates use $(r,\theta,\phi)$ with $(h_1,h_2,h_3)=(1,r,r\sin\theta)$. The coordinate ordering is selected so that $\mathbf{a}_u\times\mathbf{a}_v=\mathbf{a}_w$, providing a right-handed orthonormal basis for the operator formulas that follow.

### Key planning details

- Coordinate surfaces $u$, $v$, and $w$ are mutually perpendicular.
- Physical differential lengths are $h_1du$, $h_2dv$, and $h_3dw$.
- Scale factors may depend on all three coordinates.
- The differential volume is $h_1h_2h_3\,du\,dv\,dw$.
- Cylindrical scale factors are $(1,\rho,1)$.
- Spherical scale factors are $(1,r,r\sin\theta)$.
- The basis is ordered so that $\mathbf{a}_u\times\mathbf{a}_v=\mathbf{a}_w$.

### Source coverage

- Page 569 defines the coordinate surfaces $u=\mathrm{constant}$, $v=\mathrm{constant}$, and $w=\mathrm{constant}$.
- The differential lengths are defined as $dL_1=h_1du$, $dL_2=h_2dv$, and $dL_3=h_3dw$.
- Rectangular coordinates have $h_1=h_2=h_3=1$.
- Equation (A-1) gives cylindrical scale factors $1,\rho,1$.
- Spherical coordinates have scale factors $1,r,r\sin\theta$.
- Page 570 states $\mathbf{a}_u\times\mathbf{a}_v=\mathbf{a}_w$.
