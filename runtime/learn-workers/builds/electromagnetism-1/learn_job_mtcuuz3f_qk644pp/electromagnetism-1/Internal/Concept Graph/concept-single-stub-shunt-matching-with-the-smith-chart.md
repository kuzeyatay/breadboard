---
title: "Single-Stub Shunt Matching with the Smith Chart"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "single-stub-shunt-matching-with-the-smith-chart"
locations: ["Page 357", "Page 358", "Page 359"]
related: ["smith-chart-locations-of-voltage-extrema-and-vswr", "slotted-line-determination-of-an-unknown-load", "smith-chart-motion-along-a-lossless-line"]
---

## ConceptNode: Single-Stub Shunt Matching with the Smith Chart

Planning node for [[single-stub-shunt-matching-with-the-smith-chart|1.200 Single-Stub Shunt Matching with the Smith Chart]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 357, Page 358, Page 359

A short-circuited shunt stub can cancel the susceptance of a transformed load and produce a matched normalized admittance of $1+j0$. Because the stub is connected in parallel, the design is performed with admittances. Starting from $z_L=2.1+j0.8$, the corresponding normalized load admittance is found by moving one-quarter wavelength on the Smith chart, yielding $y_L=0.41-j0.16$. Along the same constant-VSWR circle, there are two points where conductance is unity: $1+j0.95$ and $1-j0.95$. Selecting $1+j0.95$ gives the shorter stub, which must supply $y_{\mathrm{stub}}=-j0.95$. The selected unity-conductance point lies 0.19 wavelength toward the generator from the load. For a short-circuited stub, the chart starts at $y=\infty$ and wtg $=0.250$. Moving to the point where $b=-0.95$ gives wtg $=0.379$, so the stub length is $0.129\lambda$, or 9.67 cm for the 75 cm wavelength.

### Key planning details

- Express the parallel matching condition in normalized admittance.
- Require the transformed main-line admittance to have conductance $g=1$.
- If the main-line admittance is $1+jb_{\mathrm{in}}$, choose $y_{\mathrm{stub}}=-jb_{\mathrm{in}}$.
- Convert impedance to admittance by a quarter-wavelength chart rotation.
- There are generally two unity-conductance intersections on the constant-VSWR circle.
- Choose between the two intersections according to desired stub and placement lengths.
- A short-circuited stub remains on the zero-conductance perimeter of the admittance chart.
- The worked design uses $d=0.19\lambda$ and stub length $d_1=0.129\lambda$.

### Source coverage

- Source figure S1.P357.F2, Figure 10.17, shows a short-circuited shunt stub a distance $d$ from the load.
- Page 358 states the required total normalized admittance as $1+j0$.
- Page 358 converts $z_L=2.1+j0.8$ to $y_L=0.41-j0.16$ by a quarter-wavelength chart shift.
- Page 358 identifies the two unity-conductance points as $1+j0.95$ and $1-j0.95$.
- Page 358 selects $y_{\mathrm{stub}}=-j0.95$ and locates the stub $0.19\lambda$ from the load.
- Source figure S1.P358.F1, Figure 10.18, shows the complete matching construction and stub length $0.129\lambda$.
- Page 359 includes Problem D10.8 on shortest stub placement, shortest stub length, and VSWR in each line segment.
