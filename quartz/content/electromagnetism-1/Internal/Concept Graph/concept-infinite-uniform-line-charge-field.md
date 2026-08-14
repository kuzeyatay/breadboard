---
title: "Infinite Uniform Line Charge Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "infinite-uniform-line-charge-field"
locations: ["Page 69", "Page 70", "Page 84", "Page 85", "Figure 3.4"]
related: ["choosing-gaussian-surfaces-by-symmetry", "coaxial-cable-field-and-electrostatic-shielding", "fields-from-layered-charge-distributions", "gauss-law-in-integral-form"]
---

## ConceptNode: Infinite Uniform Line Charge Field

Planning node for [[infinite-uniform-line-charge-field|1.58 Infinite Uniform Line Charge Field]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 69, Page 70, Page 84, Page 85, Figure 3.4

An infinite uniform line charge on the $z$ axis has cylindrical symmetry. Translation along $z$ and rotation about the axis cannot change the field, so the electric flux density has only a radial cylindrical component and depends only on radial distance: $\mathbf{D}=D_\rho(\rho)\mathbf{a}_\rho$. A right circular cylinder of radius $\rho$ and length $L$, coaxial with the line, is chosen as the gaussian surface. The field is normal and constant on the curved side, while it is parallel to the end faces, so the end-face flux is zero. The total flux is therefore $D_\rho(2\pi\rho L)$. The enclosed charge is $Q=\rho_LL$, where $\rho_L$ is the line charge density. Equating flux and charge gives $D_\rho=\rho_L/(2\pi\rho)$ and, in free space, $E_\rho=\rho_L/(2\pi\epsilon_0\rho)$. The field decreases as $1/\rho$ because the area of the cylindrical side grows linearly with radius. This derivation illustrates how symmetry converts a surface integral into multiplication by the lateral area.

### Key planning details

- The field has the form $\mathbf{D}=D_\rho(\rho)\mathbf{a}_\rho$.
- A coaxial cylindrical gaussian surface matches the symmetry.
- The curved side has area $2\pi\rho L$.
- The field is parallel to the top and bottom faces, so their flux is zero.
- The enclosed line charge is $Q=\rho_LL$.
- The flux density is $\mathbf{D}=\rho_L\mathbf{a}_\rho/(2\pi\rho)$.
- In free space, $\mathbf{E}=\rho_L\mathbf{a}_\rho/(2\pi\epsilon_0\rho)$.

### Source coverage

- Page 69 identifies $\mathbf{D}=D_\rho\mathbf{a}_\rho$ and $D_\rho=f(\rho)$.
- Pages 69 and 70 calculate $Q=D_S2\pi\rho L$ for a cylindrical gaussian surface.
- Page 70 substitutes $Q=\rho_LL$ to obtain $D_\rho=\rho_L/(2\pi\rho)$.
- S1.P70.F1 shows radial $\mathbf{D}$ normal to the cylinder side and parallel to both end faces.
- Problems 3.10, 3.11, 3.15, and 3.16 on Pages 84 and 85 apply cylindrical symmetry to distributed charge.
