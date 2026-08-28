---
title: "Constant-Resistance and Constant-Reactance Circles"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "constant-resistance-and-constant-reactance-circles"
locations: ["Page 350", "Page 351"]
related: ["smith-chart-impedance-and-reflection-coefficient-mapping", "reading-reflection-coefficient-from-the-smith-chart", "smith-chart-locations-of-voltage-extrema-and-vswr"]
---

## ConceptNode: Constant-Resistance and Constant-Reactance Circles

Planning node for [[constant-resistance-and-constant-reactance-circles|1.195 Constant-Resistance and Constant-Reactance Circles]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 350, Page 351

Writing $\Gamma=\Gamma_r+j\Gamma_i$ and separating the inverse impedance transformation into real and imaginary parts reveals the geometric structure of the Smith chart. The normalized resistance and reactance are $$r=\frac{1-\Gamma_r^2-\Gamma_i^2}{(1-\Gamma_r)^2+\Gamma_i^2},\qquad x=\frac{2\Gamma_i}{(1-\Gamma_r)^2+\Gamma_i^2}.$$ Rearranging produces circle equations. A constant-$r$ circle has center $\left(r/(1+r),0\right)$ and radius $1/(1+r)$. Every such circle is centered on the $\Gamma_r$ axis and passes through $\Gamma=1+j0$. A constant-$x$ circle has center $\left(1,1/x\right)$ and radius $1/|x|$; only the portions within $|\Gamma|=1$ appear. Positive reactance lies above the horizontal axis and negative reactance below it. The $x=0$ locus is the $\Gamma_r$ axis. The limiting cases connect the geometry to physical loads: $r=0$ is the unit circle associated with pure reactance, while infinite resistance or reactance collapses to the open-circuit point $\Gamma=1$.

### Key planning details

- Resolve $\Gamma$ into $\Gamma_r+j\Gamma_i$ before separating resistance and reactance.
- Constant resistance obeys $$\left(\Gamma_r-\frac{r}{1+r}\right)^2+\Gamma_i^2=\left(\frac{1}{1+r}\right)^2.$$
- A constant-$r$ circle has radius $1/(1+r)$.
- Constant reactance obeys $$(\Gamma_r-1)^2+\left(\Gamma_i-\frac{1}{x}\right)^2=\left(\frac{1}{x}\right)^2.$$
- A constant-$x$ circle has radius $1/|x|$.
- All constant-$r$ and constant-$x$ circles meet at the open-circuit point $\Gamma=1$.
- The zero-reactance locus is the horizontal reflection-coefficient axis.

### Source coverage

- Page 350 gives Eqs. (108) through (111), separating normalized resistance and reactance.
- Page 350 gives the constant-$r$ and constant-$x$ circle equations as Eqs. (112) and (113).
- Page 350 identifies the $r=0$, $r=1$, and $r\to\infty$ limiting geometries.
- Source figure S1.P351.F1, Figure 10.10, shows constant-$r$ circles for $r=0.5$, $1$, and $2$.
- Source figure S1.P351.F2, Figure 10.11, shows the portions of constant-$x$ circles inside $|\Gamma|=1$.
- Page 350 states that the $x=0$ circle degenerates to the $\Gamma_r$ axis.
