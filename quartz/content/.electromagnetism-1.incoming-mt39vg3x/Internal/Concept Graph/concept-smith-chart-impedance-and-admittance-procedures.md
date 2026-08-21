---
title: "Smith-Chart Impedance and Admittance Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "smith-chart-impedance-and-admittance-procedures"
locations: ["Page 376", "Page 377"]
related: ["transmission-line-reflection-and-standing-wave-analysis", "single-stub-and-reactive-matching", "quarter-wave-impedance-transformation"]
---

## ConceptNode: Smith-Chart Impedance and Admittance Procedures

Planning node for [[smith-chart-impedance-and-admittance-procedures|1.211 Smith-Chart Impedance and Admittance Procedures]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 376, Page 377

The Smith-chart exercises use normalized impedance or admittance to represent reflection and transformation on lossless lines. The procedure begins by normalizing the load, locating it on the chart, and following the constant-VSWR circle toward the generator by the required electrical length. At the destination, the chart yields normalized input impedance or admittance, which is then denormalized. The same construction can find the nearest voltage maximum or minimum, the shortest distance to a purely resistive input, and the shortest line length that reproduces a specified impedance. Admittance problems use the same reflection geometry after converting from impedance or working directly with normalized admittance. The source includes tasks in which the line is cut at a real-input point and replaced with a resistor, making the remaining line matched, as well as tasks that reconstruct an unknown load from input data and line length. A plotting problem asks for $|Z_{\mathrm{in}}|$ versus normalized length over a quarter wavelength, emphasizing that the chart can generate a continuous transformation curve rather than only a single answer.

### Key planning details

- Normalize impedance as $z=Z/Z_0$ or admittance as $y=Y/Y_0$.
- Move toward the generator along a constant-VSWR circle by the specified electrical length.
- Denormalize the chart reading to recover physical impedance or admittance.
- Real-axis crossings identify locations where input impedance or admittance is purely real.
- Voltage maxima and minima correspond to specific real-axis points on the constant-VSWR circle.
- A line transformation repeats every $0.5\lambda$.
- A quarter-wavelength chart sweep can be used to plot the full range of input-impedance magnitude.

### Source coverage

- Problem 10.23 starts from normalized load $z_L=2+j1$ with $\lambda=20$ m and asks for the nearest positive-real input impedance.
- Problem 10.24 requests a plot of $|Z_{\mathrm{in}}|$ versus $l$ over $0<l/\lambda<0.25$ using Figure 10.33.
- Problem 10.27 gives $Y_0=20$ mS and $Y_L=40-j20$ mS and asks for $s$, $Y_{\mathrm{in}}$ at $l=0.15\lambda$, and the nearest voltage maximum.
- Problem 10.28 gives $\lambda=10$ cm and normalized input impedance $z_{\mathrm{in}}=1+j2$.
- Problem 10.26 combines a $1.2\lambda$, $75\,\Omega$ line with a $50\,\Omega$ line and supplies VSWR and voltage-minimum position data.
- Figure 10.33, S1.P377.F1, must be used to recover the specific circuit data for the requested $|Z_{\mathrm{in}}|$ curve.
