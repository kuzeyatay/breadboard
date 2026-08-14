---
title: "Transmission-Line Reflection and Standing-Wave Analysis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "transmission-line-reflection-and-standing-wave-analysis"
locations: ["Page 375", "Page 376", "Page 377", "Page 378"]
related: ["quarter-wave-impedance-transformation", "smith-chart-impedance-and-admittance-procedures", "single-stub-and-reactive-matching", "charged-line-transients-and-reflection-diagrams", "wave-superposition-and-current-standing-waves"]
---

## ConceptNode: Transmission-Line Reflection and Standing-Wave Analysis

Planning node for [[transmission-line-reflection-and-standing-wave-analysis|1.210 Transmission-Line Reflection and Standing-Wave Analysis]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 375, Page 376, Page 377, Page 378

The standing-wave problems connect load impedance, reflection coefficient, voltage maxima and minima, and input impedance along a lossless line. A mismatch creates incident and reflected waves whose interference gives a standing-wave ratio, denoted $s$ or VSWR. Measurements of the ratio and the position of the first voltage minimum determine both the magnitude and phase of the load reflection coefficient. Once that coefficient is known, the load impedance follows by denormalization with $Z_0$. Conversely, a known load can be transformed along a line to find an input impedance, a nearest voltage maximum, or a location where the impedance is purely real. Several exercises use probe measurements, replacement of the load by a short circuit, and spacing between minima to infer wavelength, frequency, and the unknown load. Other problems place loads at intermediate positions or join lines with different characteristic impedances, requiring the transformed impedance of one section to serve as the load of the next. Figures 10.30 through 10.34 provide source circuit geometries and measurement arrangements that must remain attached to these procedures.

### Key planning details

- VSWR determines the magnitude of the reflection coefficient.
- The position of a voltage minimum determines reflection-coefficient phase.
- Input impedance repeats every half wavelength on a lossless line.
- A short circuit provides a reference pattern for determining wavelength and spatial phase.
- Voltage maxima and minima can be used to infer both VSWR and load impedance.
- Cascaded line sections are analyzed from the load toward the source.
- Normalized impedance or admittance is converted back using $Z_0$ or $Y_0$.

### Source coverage

- Problem 10.21 gives $Z_0=400\,\Omega$, $f=200$ MHz, and $Z_{\mathrm{in}}=200-j200\,\Omega$, and asks for $s$, $Z_L$, and the nearest voltage maximum.
- Problem 10.22 gives VSWR 5.0 and the first voltage minimum at $0.10\lambda$ in front of the load.
- Problem 10.25 uses measured $|V|_{\max}$, $|V|_{\min}$, and their positions to determine $Z_L$.
- Problem 10.29 uses minima spacing of 25 cm under short-circuit replacement and a 7 cm displacement from a marked minimum.
- Problem 10.30 uses a short-circuit reference minimum 16 cm from point X, then a loaded minimum 5 cm from X with maximum-to-minimum ratio 3.
- Figures 10.30, 10.31, 10.32, 10.33, and 10.34 should be retained as S1.P375.F2, S1.P376.F1, S1.P376.F2, S1.P377.F1, and S1.P378.F1 and assigned to their associated network or probe-analysis tasks.
