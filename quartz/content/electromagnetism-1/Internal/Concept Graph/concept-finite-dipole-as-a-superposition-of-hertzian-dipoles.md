---
title: "Finite Dipole as a Superposition of Hertzian Dipoles"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "finite-dipole-as-a-superposition-of-hertzian-dipoles"
locations: ["Page 542", "Page 543", "Section 14.4.2", "Figure 14.7"]
related: ["standing-wave-current-on-a-finite-dipole", "parity-based-evaluation-of-the-dipole-field-integral", "dipole-e-plane-pattern-function"]
---

## ConceptNode: Finite Dipole as a Superposition of Hertzian Dipoles

Planning node for [[finite-dipole-as-a-superposition-of-hertzian-dipoles|1.318 Finite Dipole as a Superposition of Hertzian Dipoles]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 542, Page 543, Section 14.4.2, Figure 14.7

The field of a finite wire dipole is derived by dividing the antenna into differential Hertzian dipoles of length $dz$. Each differential element carries the local current $I_s(z)$ prescribed by the standing-wave distribution. Its far-zone contribution is $dE_{\theta s}=j[I_s(z)k\eta\sin\theta'/(4\pi r')]e^{-jkr'}dz$. Because each element has a different origin, its local distance $r'$ and angle $\theta'$ must be related to coordinates measured from the antenna feed. In the far zone, the observation lines are approximately parallel, giving $r'\simeq r-z\cos\theta$ and $\theta'\simeq\theta$. The small difference between $r'$ and $r$ is neglected in the slowly varying amplitude denominator, but it is retained in the exponential phase. This distinction is essential because a small path-length change has little effect on $1/r$ but can significantly alter the phase $kr'$. Integrating the phase-adjusted differential fields from $-\ell$ to $+\ell$ produces the complete finite-dipole far field.

### Key planning details

- The finite antenna is decomposed into differential Hertzian dipoles of length $dz$.
- Each differential element carries the position-dependent current $I_s(z)$.
- The local far field contains both the element factor $\sin\theta'$ and propagation phase $e^{-jkr'}$.
- Far-zone geometry gives $r'\simeq r-z\cos\theta$ and $\theta'\simeq\theta$.
- The approximation $r'\simeq r$ is used in the amplitude denominator.
- The path correction $-z\cos\theta$ must remain in the phase.
- The total field is the integral of all differential contributions over the wire.

### Source coverage

- Figure S26.P543.F14.7 depicts the dipole as a stack of Hertzian dipoles, including one element at coordinate $z$ with length $dz$.
- Equation (53), Page 542: $dE_{\theta s}=j\frac{I_s(z)k\,dz}{4\pi r'}\eta\sin\theta' e^{-jkr'}$.
- Equation (54), Page 543: $r'\simeq r-z\cos\theta$.
- Equation (55), Page 543 retains the path correction in $e^{-jk(r-z\cos\theta)}$ while replacing $r'$ by $r$ in the denominator.
- Equation (56), Page 543 integrates contributions over $-\ell\le z\le\ell$.
- The Figure 14.7 caption states that $r$ and $r'$ are approximately parallel in the far zone and differ by $z\cos\theta$.
