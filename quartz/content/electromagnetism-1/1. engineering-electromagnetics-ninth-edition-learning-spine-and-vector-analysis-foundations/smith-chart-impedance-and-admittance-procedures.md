---
title: "1.211 Smith-Chart Impedance and Admittance Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 376", "Page 377"]
related: ["transmission-line-reflection-and-standing-wave-analysis", "single-stub-and-reactive-matching", "quarter-wave-impedance-transformation"]
---

# 1.211 Smith-Chart Impedance and Admittance Procedures

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 376, Page 377

The Smith-chart exercises use normalized impedance or admittance to represent reflection and transformation on lossless lines. The procedure begins by normalizing the load, locating it on the chart, and following the constant-VSWR circle toward the generator by the required electrical length. At the destination, the chart yields normalized input impedance or admittance, which is then denormalized. The same construction can find the nearest voltage maximum or minimum, the shortest distance to a purely resistive input, and the shortest line length that reproduces a specified impedance. Admittance problems use the same reflection geometry after converting from impedance or working directly with normalized admittance. The source includes tasks in which the line is cut at a real-input point and replaced with a resistor, making the remaining line matched, as well as tasks that reconstruct an unknown load from input data and line length. A plotting problem asks for $|Z_{\mathrm{in}}|$ versus normalized length over a quarter wavelength, emphasizing that the chart can generate a continuous transformation curve rather than only a single answer.

## Page-Grounded Details

#### Page 376

Figure 10.31 See Problem 10.18.

10.19 $\blacktriangleleft$ A lossless transmission line is 50 cm in length and operates at a frequency of 100 MHz. The line parameters are $L=0.2\ \mu$H/m and $C=80\ \text{pF/m}$. The line is terminated in a short circuit at $z=0$, and there is a load $Z_{L}=50+j20\ \Omega$ across the line at location $z=-20$ cm. What average power is delivered to $Z_{L}$ if the input voltage is $100\angle 0^{\circ}$ V?

10.20 $\blacktriangleleft$ (a) Determine $s$ on the transmission line of Figure 10.32. Note that the dielectric is air. (b) Find the input impedance. (c) If $\omega L=10\ \Omega$, find $I_{s}$. (d) What value of $L$ will produce a maximum value for $|I_{s}|$ at $\omega=1\ \text{Grad/s}$? For this value of $L$, calculate the average power (e) supplied by the source; (f) delivered to $Z_{L}=40+j30\ \Omega$.

10.21 $\blacktriangleleft$ A lossless line having an air dielectric has a characteristic impedance of 400 $\Omega$. The line is operating at 200 MHz and $Z_{\text{in}}=200-j200\ \Omega$. Use analytic methods or the Smith chart (or both) to find (a) $s$; (b) $Z_{L}$, if the line is 1 m long; (c) the dista

[Truncated for analysis]

#### Page 377

Figure 10.33 See Problem 10.24.

10.24 With the aid of the Smith chart, plot a curve of $|Z_{\rm in}|$ versus l for the transmission line shown in Figure 10.33. Cover the range $0<l/\lambda<0.25$.

10.25 A 300-$\Omega$ transmission line is short-circuited at $z=0$. A voltage maximum, $|V|_{\rm max}=10$ V, is found at $z=-25$ cm, and the minimum voltage, $|V|_{\rm min}=0$, is at $z=-50$ cm. Use the Smith chart to find $Z_{L}$ (with the short circuit replaced by the load) if the voltage readings are (a) $|V|_{\rm max}=12$ V at $z=-5$ cm, and $|V|_{\rm min}=5$ V; (b) $|V|_{\rm max}=17$ V at $z=-20$ cm, and $|V|_{\rm min}=0$.

10.26 A 75-$\Omega$ lossless line is of length $1.2~{}\lambda$. It is terminated by an unknown load impedance. The input end of the 75-$\Omega$ line is attached to the load end of a lossless 50-$\Omega$ line. A VSWR of 4 is measured on the 75-$\Omega$ line, on which the first voltage minimum occurs at a distance of $0.15~{}\lambda$ in front of the junction between the two lines. Use the Smith chart to find the unknown load impedance.

10.27 The characteristic admittance ($Y_{0}=1/Z_{0}$) of a lossless transmission line

[Truncated for analysis]

## Core Ideas

- Normalize impedance as $z=Z/Z_0$ or admittance as $y=Y/Y_0$.
- Move toward the generator along a constant-VSWR circle by the specified electrical length.
- Denormalize the chart reading to recover physical impedance or admittance.
- Real-axis crossings identify locations where input impedance or admittance is purely real.
- Voltage maxima and minima correspond to specific real-axis points on the constant-VSWR circle.
- A line transformation repeats every $0.5\lambda$.
- A quarter-wavelength chart sweep can be used to plot the full range of input-impedance magnitude.

## Source Anchors

- Problem 10.23 starts from normalized load $z_L=2+j1$ with $\lambda=20$ m and asks for the nearest positive-real input impedance.
- Problem 10.24 requests a plot of $|Z_{\mathrm{in}}|$ versus $l$ over $0<l/\lambda<0.25$ using Figure 10.33.
- Problem 10.27 gives $Y_0=20$ mS and $Y_L=40-j20$ mS and asks for $s$, $Y_{\mathrm{in}}$ at $l=0.15\lambda$, and the nearest voltage maximum.
- Problem 10.28 gives $\lambda=10$ cm and normalized input impedance $z_{\mathrm{in}}=1+j2$.
- Problem 10.26 combines a $1.2\lambda$, $75\,\Omega$ line with a $50\,\Omega$ line and supplies VSWR and voltage-minimum position data.
- Figure 10.33, S1.P377.F1, must be used to recover the specific circuit data for the requested $|Z_{\mathrm{in}}|$ curve.

## Related Pages

- [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- [[single-stub-and-reactive-matching|Single-Stub and Reactive Matching]]
- [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]

## Concept Dependencies

- applies-to: [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- enables: [[single-stub-and-reactive-matching|Single-Stub and Reactive Matching]]
- related: [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]
