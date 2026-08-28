---
title: "Reading Reflection Coefficient from the Smith Chart"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "reading-reflection-coefficient-from-the-smith-chart"
locations: ["Page 351", "Page 352"]
related: ["smith-chart-impedance-and-reflection-coefficient-mapping", "constant-resistance-and-constant-reactance-circles", "smith-chart-motion-along-a-lossless-line"]
---

## ConceptNode: Reading Reflection Coefficient from the Smith Chart

Planning node for [[reading-reflection-coefficient-from-the-smith-chart|1.196 Reading Reflection Coefficient from the Smith Chart]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 351, Page 352

A normalized load $z_L=r+jx$ is plotted at the intersection of its constant-resistance and constant-reactance circles. The radial distance from the chart origin gives $|\Gamma|$, usually through an auxiliary radial scale, while a line from the origin through the plotted point reaches the circumference at the reflection phase $\phi$. The chart deliberately omits dense concentric magnitude circles and radial phase lines, so these quantities are read using the auxiliary scales. For $Z_L=25+j50\ \Omega$ on a 50 $\Omega$ line, normalization gives $z_L=0.5+j1$. The intersection of the $r=0.5$ and $x=1$ circles is point A in Figure 10.12. Its radius and angle give approximately $\Gamma=0.62\angle83^\circ$. This procedure turns an algebraic complex division into a geometric intersection and two scale readings, while preserving enough accuracy for many engineering calculations.

### Key planning details

- Divide $Z_L$ by $Z_0$ before entering the Smith chart.
- Locate the point at the intersection of the required $r$ and $x$ circles.
- Measure $|\Gamma|$ as radial distance from the origin.
- Read $\phi$ where the radial line reaches the circumference.
- Interpolate between labeled resistance and reactance circles when necessary.
- For $z_L=0.5+j1$, the chart gives approximately $\Gamma=0.62\angle83^\circ$.

### Source coverage

- Pages 351 and 352 describe locating $z_L$ from the intersection of constant-$r$ and constant-$x$ circles.
- Page 351 explains the auxiliary radial scale used to determine $|\Gamma|$.
- Page 351 explains extending a line to the circumference to read $\phi$.
- Source figure S1.P352.F1, Figure 10.12, shows the combined chart, radial scale, angular scale, and point A.
- Page 352 uses $Z_L=25+j50\ \Omega$, $Z_0=50\ \Omega$, and $z_L=0.5+j1$ to obtain approximately $0.62\angle83^\circ$.
