---
title: "Voltage Standing Wave Ratio and Load Recovery"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "voltage-standing-wave-ratio-and-load-recovery"
locations: ["Page 337", "Page 338", "Page 340", "Page 341"]
related: ["standing-wave-decomposition-and-voltage-extrema", "reflection-at-a-load-discontinuity", "finite-lossless-line-input-impedance", "matched-and-mismatched-receiver-line-example"]
---

## ConceptNode: Voltage Standing Wave Ratio and Load Recovery

Planning node for [[voltage-standing-wave-ratio-and-load-recovery|1.187 Voltage Standing Wave Ratio and Load Recovery]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 337, Page 338, Page 340, Page 341

Voltage standing wave ratio is the ratio of the maximum to minimum measured voltage amplitude on a lossless line. Using the extrema created by incident and reflected waves gives $$s=\frac{V_{\max}}{V_{\min}}=\frac{1+|\Gamma|}{1-|\Gamma|},$$ so $|\Gamma|=(s-1)/(s+1)$. A matched termination has $|\Gamma|=0$ and $s=1$, while a totally reflecting load has $|\Gamma|=1$ and unbounded VSWR. A slotted line measures maxima, minima, their spacing, and their displacement from the load. The spacing gives $\lambda/2$, while the first extremum position determines the reflection phase through the extremum-location equations. Once magnitude and phase of $\Gamma$ are known, $Z_L$ follows from $\Gamma=(Z_L-Z_0)/(Z_L+Z_0)$. Example 10.7 uses $s=5$, $15$ cm maximum spacing, and a first maximum $7.5$ cm from the load to find $\lambda=30$ cm, $f=1$ GHz, $\Gamma=-2/3$, and $Z_L=10\ \Omega$ for $Z_0=50\ \Omega$.

### Key planning details

- $s=(1+|\Gamma|)/(1-|\Gamma|)$.
- $|\Gamma|=(s-1)/(s+1)$.
- A matched load gives $s=1$.
- A totally reflecting load gives infinite VSWR.
- Extremum spacing determines wavelength.
- Extremum position relative to the load determines reflection phase.
- Magnitude and phase of $\Gamma$ determine the load impedance.

### Source coverage

- Equation (92) defines VSWR.
- D10.3 states that $\Gamma=\pm1/2$ gives VSWR $3$.
- Example 10.7 identifies $15$ cm as $\lambda/2$ and obtains $\lambda=30$ cm.
- The air-filled line frequency is calculated as $1$ GHz.
- The first maximum at $\lambda/4$ implies a negative real reflection coefficient.
- The example obtains $\Gamma=-2/3$ and $Z_L=10\ \Omega$.
