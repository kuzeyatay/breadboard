---
title: "Smith Chart Locations of Voltage Extrema and VSWR"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "smith-chart-locations-of-voltage-extrema-and-vswr"
locations: ["Page 354", "Page 355"]
related: ["standing-wave-voltage-extrema-on-a-lossless-line", "smith-chart-motion-along-a-lossless-line", "single-stub-shunt-matching-with-the-smith-chart", "constant-resistance-and-constant-reactance-circles"]
---

## ConceptNode: Smith Chart Locations of Voltage Extrema and VSWR

Planning node for [[smith-chart-locations-of-voltage-extrema-and-vswr|1.198 Smith Chart Locations of Voltage Extrema and VSWR]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 354, Page 355

Voltage maxima and minima occur where the input impedance is purely resistive, so they lie on the $x=0$ axis of the Smith chart. The high-resistance intersection, $r>1$, corresponds to a voltage maximum and current minimum and is assigned wavelengths-toward-generator value 0.25. The low-resistance intersection, $r<1$, corresponds to a voltage minimum and current maximum and is assigned value 0. In Example 10.10, the load point is at 0.135 wtg, so the nearest voltage maximum toward the generator is $0.250-0.135=0.115\lambda$, or 23 cm for a 2 m wavelength. The constant-$|\Gamma|$ circle crosses the high-resistance axis at $r=4.2$, directly giving $s=4.2$. The same chart can be used for normalized admittance $y_L=g+jb$, treating resistance circles as conductance circles and reactance circles as susceptance circles. In admittance use, the $g>1$, $b=0$ segment corresponds to a voltage minimum, and the reflection angle differs by $180^\circ$ from the impedance-chart reading.

### Key planning details

- Voltage extrema occur where $x=0$ and the input impedance is purely resistive.
- At $r>1$, the line has a voltage maximum and current minimum.
- At $r<1$, the line has a voltage minimum and current maximum.
- The high-resistance intersection occurs at wtg $=0.25$.
- The low-resistance intersection occurs at wtg $=0$.
- The high-resistance axis crossing gives the VSWR directly as $s=r$.
- Admittance plotting reinterprets $r,x$ circles as $g,b$ circles and shifts the reflection angle by $180^\circ$.

### Source coverage

- Pages 354 and 355 identify purely resistive chart locations as voltage maxima or minima.
- Page 354 assigns voltage maxima to $r>1$ at wtg $=0.25$ and minima to $r<1$ at wtg $=0$.
- Page 355 locates the Example 10.10 maximum $0.115\lambda$, or 23 cm, from the load.
- Page 355 reads $s=4.2$ at point C.
- Page 355 explains normalized admittance use and the required $180^\circ$ reflection-angle adjustment.
- Page 355 includes Problem D10.6 on input impedance, VSWR, voltage-maximum distance, and resistive replacement planes.
