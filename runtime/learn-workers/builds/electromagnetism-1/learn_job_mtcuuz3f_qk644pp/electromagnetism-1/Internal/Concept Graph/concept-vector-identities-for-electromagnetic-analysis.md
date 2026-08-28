---
title: "Vector Identities for Electromagnetic Analysis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "vector-identities-for-electromagnetic-analysis"
locations: ["Page 572, Section A.3", "Page 581, Appendix D"]
related: ["divergence-in-orthogonal-curvilinear-coordinates", "gradient-curl-and-laplacian-in-curvilinear-coordinates", "uniqueness-theorem-for-laplace-and-poisson-equations"]
---

## ConceptNode: Vector Identities for Electromagnetic Analysis

Planning node for [[vector-identities-for-electromagnetic-analysis|1.346 Vector Identities for Electromagnetic Analysis]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 572, Section A.3, Page 581, Appendix D

The appendix collects vector identities that support electromagnetic derivations. The scalar triple product is invariant under cyclic permutation, while the vector triple product satisfies $\mathbf{A}\times(\mathbf{B}\times\mathbf{C})=(\mathbf{A}\cdot\mathbf{C})\mathbf{B}-(\mathbf{A}\cdot\mathbf{B})\mathbf{C}$. Divergence, gradient, and curl distribute over sums. Product rules include $\nabla\cdot(V\mathbf{A})=\mathbf{A}\cdot\nabla V+V\nabla\cdot\mathbf{A}$, $\nabla(VW)=V\nabla W+W\nabla V$, and $\nabla\times(V\mathbf{A})=\nabla V\times\mathbf{A}+V\nabla\times\mathbf{A}$. Identities for vector products expand the divergence of a cross product, the gradient of a dot product, and the curl of a cross product. The second-order identities include $\nabla\cdot(\nabla\times\mathbf{A})=0$, $\nabla\times(\nabla V)=0$, and $$\nabla\times\nabla\times\mathbf{A}=\nabla(\nabla\cdot\mathbf{A})-\nabla^2\mathbf{A}.$$ These identities are algebraic tools, but they also encode important structural facts such as curls being divergence-free and gradients being irrotational. The scalar-vector divergence product rule is later used directly in the uniqueness proof.

### Key planning details

- Scalar triple products are invariant under cyclic permutation.
- The vector triple product is not associative and must be expanded by identity.
- Vector differential operators distribute over sums.
- Scalar multiplication introduces product-rule terms.
- $\nabla\cdot(\nabla\times\mathbf{A})=0$.
- $\nabla\times(\nabla V)=0$.
- The double-curl identity separates longitudinal and Laplacian contributions.

### Source coverage

- Equations (A.6) and (A.7) give scalar and vector triple-product identities.
- Equations (A.8) to (A.10) give sum rules.
- Equations (A.11) to (A.13) give scalar product rules for differential operators.
- Equations (A.14) to (A.16) give vector-product operator identities.
- Equations (A.17) to (A.20) give second-order identities.
- The identity $\nabla\cdot(V\mathbf{D})=V\nabla\cdot\mathbf{D}+\mathbf{D}\cdot\nabla V$ is used on Page 581.
