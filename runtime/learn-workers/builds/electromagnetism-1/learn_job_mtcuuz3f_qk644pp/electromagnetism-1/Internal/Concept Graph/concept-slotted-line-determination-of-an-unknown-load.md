---
title: "Slotted-Line Determination of an Unknown Load"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "slotted-line-determination-of-an-unknown-load"
locations: ["Page 356", "Page 357"]
related: ["smith-chart-motion-along-a-lossless-line", "smith-chart-locations-of-voltage-extrema-and-vswr", "single-stub-shunt-matching-with-the-smith-chart", "reading-reflection-coefficient-from-the-smith-chart"]
---

## ConceptNode: Slotted-Line Determination of an Unknown Load

Planning node for [[slotted-line-determination-of-an-unknown-load|1.199 Slotted-Line Determination of an Unknown Load]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 356, Page 357

A slotted-line measurement can determine an unknown complex load from the VSWR and the position of a standing-wave minimum. In the example, a 50 $\Omega$ line has $s=2.5$, a measured minimum at 47.0 cm, and wavelength 75 cm. Replacing the load with a short circuit moves the measured minimum to 26.0 cm. Because a short circuit lies an integral number of half-wavelengths from a voltage minimum, the load plane may be assigned to $26.0-37.5=-11.5$ cm. The original minimum is then 58.5 cm from that plane, equivalent modulo $\lambda/2$ to 21.0 cm. The nearest maximum is another $\lambda/4=18.75$ cm closer to the load, so it lies 2.25 cm, or $0.030\lambda$, from the load. At a maximum, normalized resistance equals the VSWR, so the chart starts at $z=2.5+j0$. Moving 0.030 wavelength back to the load gives $z_L=2.1+j0.8$, hence $Z_L=105+j40\ \Omega$.

### Key planning details

- Measure VSWR from the maximum and minimum voltage readings.
- Use voltage minima because their positions can be measured more sharply than maxima.
- Replace the unknown load with a short circuit to establish a reference load plane.
- Short-circuit minima repeat every $\lambda/2$.
- Convert the measured minimum position into an equivalent distance within one half-wavelength.
- Move by $\lambda/4$ between a minimum and the adjacent maximum.
- At a maximum, enter the chart at normalized resistance $r=s$.
- Specify the reference plane at which the recovered load impedance applies.

### Source coverage

- Source figure S1.P356.F1, Figure 10.15, shows the slotted line, scale, measured minimum positions, and 75 cm wavelength.
- Page 356 gives $s=2.5$, a load-connected minimum at 47.0 cm, and a short-circuit minimum at 26.0 cm.
- Page 356 locates the load plane at $-11.5$ cm and an equivalent minimum 21.0 cm from the load.
- Page 356 calculates a voltage maximum 2.25 cm, or $0.030\lambda$, from the load.
- Page 357 enters the chart at $z_{\mathrm{in}}=2.5$ and moves from wtg 0.250 to 0.220.
- Source figure S1.P357.F1, Figure 10.16, gives $z_L=2.1+j0.8$ and therefore $Z_L=105+j40\ \Omega$.
- Page 357 warns that load impedance must be associated with a specified point or reference plane.
