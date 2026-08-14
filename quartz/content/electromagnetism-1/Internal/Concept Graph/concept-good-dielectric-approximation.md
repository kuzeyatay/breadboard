---
title: "Good-Dielectric Approximation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "good-dielectric-approximation"
locations: ["Page 395", "Page 396", "Page 397", "Page 398"]
related: ["conductivity-as-imaginary-permittivity", "microwave-absorption-and-penetration-in-water", "good-conductor-propagation-approximation", "lossless-dielectric-plane-wave-propagation"]
---

## ConceptNode: Good-Dielectric Approximation

Planning node for [[good-dielectric-approximation|1.226 Good-Dielectric Approximation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 395, Page 396, Page 397, Page 398

A medium is classified as a good dielectric when its loss tangent is much smaller than one: $\epsilon''/\epsilon'=\sigma/(\omega\epsilon')\ll1$. Under this condition, the propagation constant can be expanded with the binomial theorem. Substituting $x=-j\sigma/(\omega\epsilon')$ and exponent $n=1/2$ into $(1+x)^n$ separates the real and imaginary parts of $jk=\alpha+j\beta$. The resulting attenuation approximation is $\alpha\doteq(\sigma/2)\sqrt{\mu/\epsilon'}$. The phase constant is $\beta\doteq\omega\sqrt{\mu\epsilon'}[1+(1/8)(\sigma/(\omega\epsilon'))^2]$, and the correction term is often negligible, leaving $\beta\doteq\omega\sqrt{\mu\epsilon'}$. A similar expansion gives $\eta\doteq\sqrt{\mu/\epsilon'}[1+j\sigma/(2\omega\epsilon')]$. The source states that deviations from the exact formulas remain within a few percent when $\sigma/(\omega\epsilon')<0.1$. Example 11.5 applies these approximations to the 2.5 GHz water case with loss tangent $7/78=0.09$ and reproduces the exact values $\alpha=21\ \mathrm{Np/m}$, $\beta=464\ \mathrm{rad/m}$, and $\eta=43+j1.9\ \Omega$ to the precision justified by the input data.

### Key planning details

- The good-dielectric criterion is $\sigma/(\omega\epsilon')\ll1$.
- The derivation uses a binomial expansion of the propagation-constant radical.
- The approximate attenuation is $\alpha\doteq(\sigma/2)\sqrt{\mu/\epsilon'}$.
- The leading phase approximation is $\beta\doteq\omega\sqrt{\mu\epsilon'}$.
- The impedance approximation is $\eta\doteq\sqrt{\mu/\epsilon'}[1+j\sigma/(2\omega\epsilon')]$.
- A loss tangent below $0.1$ normally limits deviations to a few percent.
- Approximation accuracy should be judged relative to the precision of measured material parameters.

### Source coverage

- Equation (59) writes the propagation constant with the factor $\sqrt{1-j\sigma/(\omega\epsilon')}$.
- Equations (60a) and (60b) give the good-dielectric approximations for $\alpha$ and $\beta$.
- Equation (61) drops the second-order phase correction.
- Equations (62a) and (62b) give successive intrinsic-impedance approximations.
- Example 11.5 uses a loss tangent of $7/78=0.09$ and obtains $\alpha=21\ \mathrm{Np/m}$, $\beta=464\ \mathrm{rad/m}$, and $\eta=43+j1.9\ \Omega$.
- Exercise D11.4 provides a test case with loss tangent $0.28$, $\alpha=0.016\ \mathrm{Np/m}$, $\beta=0.11\ \mathrm{rad/m}$, and $\eta=207\angle7.8^\circ\ \Omega$.
