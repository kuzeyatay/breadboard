---
title: "Parallel-Plate Wave-Equation Eigenmodes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "parallel-plate-wave-equation-eigenmodes"
locations: ["Page 491, Section 13.4 and Equations (58) through (61)", "Page 492, Equations (62) through (68)", "Page 493, Figure 13.17", "Page 494, Problem D13.9"]
related: ["transverse-resonance-and-mode-quantization", "te-mode-fields-from-plane-wave-superposition", "parallel-plate-te-magnetic-fields"]
---

## ConceptNode: Parallel-Plate Wave-Equation Eigenmodes

Planning node for [[parallel-plate-wave-equation-eigenmodes|1.278 Parallel-Plate Wave-Equation Eigenmodes]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 491, Section 13.4 and Equations (58) through (61), Page 492, Equations (62) through (68), Page 493, Figure 13.17, Page 494, Problem D13.9

The wave-equation method obtains the same discrete parallel-plate modes without relying on a ray picture. In a lossless dielectric, the phasor field obeys $$\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s,$$ with $k=n\omega/c$. For a TE mode with only $E_y$, no $y$ variation, and axial dependence $e^{-j\beta_m z}$, write $$E_{ys}=E_0f_m(x)e^{-j\beta_m z}.$$ Substitution reduces the partial differential equation to $$\frac{d^2f_m}{dx^2}+\kappa_m^2f_m=0,$$ where $\kappa_m^2=k^2-\beta_m^2$. Conducting-wall conditions require $E_y=0$ at $x=0$ and $x=d$. These eliminate the cosine solution and quantize $\kappa_m=m\pi/d$, giving $$E_{ys}=E_0\sin\left(\frac{m\pi x}{d}\right)e^{-j\beta_m z}.$$ Thus the boundary-value method reproduces the transverse-resonance result. The integer $m$ counts the number of spatial half-cycles, or equivalently electric-field maxima, across the plate spacing.

### Key planning details

- The dielectric wave equation is $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$.
- A wide guide permits neglect of $y$ variation and fringing.
- The assumed axial dependence is $e^{-j\beta_m z}$.
- Separation reduces the problem to a harmonic ordinary differential equation in $x$.
- The tangential electric field must vanish at both conducting plates.
- The boundary conditions select sine functions and $\kappa_m=m\pi/d$.
- Mode number $m$ counts transverse spatial half-cycles and field maxima.

### Source coverage

- Equations (58) through (62) reduce the vector wave equation to the transverse eigenvalue equation.
- Equation (63) gives the sine and cosine general solution.
- Equation (64) gives $\kappa_m=m\pi/d$ after applying conductor boundary conditions.
- Equation (65) gives the final TE electric-field phasor.
- Equations (66) through (68) interpret the guide at cutoff as a one-dimensional resonant cavity.
- Figure 13.17 illustrates the $m=4$ transverse phase pattern and its changing wave angle.
- Problem D13.9 states that three electric-field maxima imply $m=3$.
