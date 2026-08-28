---
title: "1.199 Slotted-Line Determination of an Unknown Load"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 356", "Page 357"]
related: ["smith-chart-motion-along-a-lossless-line", "smith-chart-locations-of-voltage-extrema-and-vswr", "single-stub-shunt-matching-with-the-smith-chart", "reading-reflection-coefficient-from-the-smith-chart"]
---

# 1.199 Slotted-Line Determination of an Unknown Load

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 356, Page 357

A slotted-line measurement can determine an unknown complex load from the VSWR and the position of a standing-wave minimum. In the example, a 50 $\Omega$ line has $s=2.5$, a measured minimum at 47.0 cm, and wavelength 75 cm. Replacing the load with a short circuit moves the measured minimum to 26.0 cm. Because a short circuit lies an integral number of half-wavelengths from a voltage minimum, the load plane may be assigned to $26.0-37.5=-11.5$ cm. The original minimum is then 58.5 cm from that plane, equivalent modulo $\lambda/2$ to 21.0 cm. The nearest maximum is another $\lambda/4=18.75$ cm closer to the load, so it lies 2.25 cm, or $0.030\lambda$, from the load. At a maximum, normalized resistance equals the VSWR, so the chart starts at $z=2.5+j0$. Moving 0.030 wavelength back to the load gives $z_L=2.1+j0.8$, hence $Z_L=105+j40\ \Omega$.

## Page-Grounded Details

#### Page 356

![Page 356 figure 1](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-356-figure-1.png)

Figure 10.15 A sketch of a coaxial slotted line. The distance scale is on the slotted line. With the load in place, $s=2.5$, and the minimum occurs at a scale reading of 47 cm. For a short circuit, the minimum is located at a scale reading of 26 cm. The wavelength is 75 cm.

We next consider two examples of practical transmission line problems. The first is the determination of load impedance from experimental data, and the second is the design of a single-stub matching network.

It is assumed that we have made experimental measurements on a 50-$\Omega$ slotted line that show there is a voltage standing wave ratio of 2.5. This has been determined by moving a sliding carriage back and forth along the line to determine maximum and minimum voltage readings. A scale provided on the track along which the carriage moves indicates that a _minimum_ occurs at a scale reading of 47.0 cm, as shown in Figure 10.15. The zero point of the scale is arbitrary and does not correspond to the location of the load. The location of the minimum is usually specified instead of

[Truncated for analysis]

#### Page 357

Figure 10.16 If $z_{\mathrm{i n}}=2.5+j0$ on a line 0.3 wavelengths long, then $z_{L}=2.1+j0.8$.

$z_{\mathrm{i n}}=2.5$. We therefore enter the chart at $z_{\mathrm{i n}}=2.5$ and read 0.250 on the wtg scale. Subtracting 0.030 wavelength to reach the load, we find that the intersection of the $s=2.5$ (or $|\Gamma|=0.429$) circle and the radial line to 0.220 wavelength is at $z_{L}=2.1+j0.8$. The construction is sketched on the Smith chart of Figure 10.16. Thus $Z_{L}=105+j40\Omega$, a value that assumes its location at a scale reading of $-11.5$ cm, or an integral number of half-wavelengths from that position. Of course, we may select the "location" of our load at will by placing the short circuit at the point that we wish to consider the load location. Since load locations are not well defined, it is important to specify the point (or plane) at which the load impedance is determined.

As a final example, let us try to match this load to the 50-$\Omega$ line by placing a short-circuited stub of length $d_{11}$ a distance $d$ from the load (see Figure 10.17). The stub line has the same characteristic impedance as the main line. The lengths $d$ and $ d_{11}

[Truncated for analysis]

## Core Ideas

- Measure VSWR from the maximum and minimum voltage readings.
- Use voltage minima because their positions can be measured more sharply than maxima.
- Replace the unknown load with a short circuit to establish a reference load plane.
- Short-circuit minima repeat every $\lambda/2$.
- Convert the measured minimum position into an equivalent distance within one half-wavelength.
- Move by $\lambda/4$ between a minimum and the adjacent maximum.
- At a maximum, enter the chart at normalized resistance $r=s$.
- Specify the reference plane at which the recovered load impedance applies.

## Source Anchors

- Source figure S1.P356.F1, Figure 10.15, shows the slotted line, scale, measured minimum positions, and 75 cm wavelength.
- Page 356 gives $s=2.5$, a load-connected minimum at 47.0 cm, and a short-circuit minimum at 26.0 cm.
- Page 356 locates the load plane at $-11.5$ cm and an equivalent minimum 21.0 cm from the load.
- Page 356 calculates a voltage maximum 2.25 cm, or $0.030\lambda$, from the load.
- Page 357 enters the chart at $z_{\mathrm{in}}=2.5$ and moves from wtg 0.250 to 0.220.
- Source figure S1.P357.F1, Figure 10.16, gives $z_L=2.1+j0.8$ and therefore $Z_L=105+j40\ \Omega$.
- Page 357 warns that load impedance must be associated with a specified point or reference plane.

## Related Pages

- [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]
- [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
- [[single-stub-shunt-matching-with-the-smith-chart|Single-Stub Shunt Matching with the Smith Chart]]
- [[reading-reflection-coefficient-from-the-smith-chart|Reading Reflection Coefficient from the Smith Chart]]

## Concept Dependencies

- depends-on: [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
- depends-on: [[smith-chart-motion-along-a-lossless-line|Smith Chart Motion Along a Lossless Line]]
- applies-to: [[reading-reflection-coefficient-from-the-smith-chart|Reading Reflection Coefficient from the Smith Chart]]
