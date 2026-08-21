---
title: "1.210 Transmission-Line Reflection and Standing-Wave Analysis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 375", "Page 376", "Page 377", "Page 378"]
related: ["quarter-wave-impedance-transformation", "smith-chart-impedance-and-admittance-procedures", "single-stub-and-reactive-matching", "charged-line-transients-and-reflection-diagrams", "wave-superposition-and-current-standing-waves"]
---

# 1.210 Transmission-Line Reflection and Standing-Wave Analysis

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 375, Page 376, Page 377, Page 378

The standing-wave problems connect load impedance, reflection coefficient, voltage maxima and minima, and input impedance along a lossless line. A mismatch creates incident and reflected waves whose interference gives a standing-wave ratio, denoted $s$ or VSWR. Measurements of the ratio and the position of the first voltage minimum determine both the magnitude and phase of the load reflection coefficient. Once that coefficient is known, the load impedance follows by denormalization with $Z_0$. Conversely, a known load can be transformed along a line to find an input impedance, a nearest voltage maximum, or a location where the impedance is purely real. Several exercises use probe measurements, replacement of the load by a short circuit, and spacing between minima to infer wavelength, frequency, and the unknown load. Other problems place loads at intermediate positions or join lines with different characteristic impedances, requiring the transformed impedance of one section to serve as the load of the next. Figures 10.30 through 10.34 provide source circuit geometries and measurement arrangements that must remain attached to these procedures.

## Page-Grounded Details

#### Page 375

Figure 10.29 See Problem 10.15.

per unit length, G, is zero. The 50-$\Omega$ line has a measured power loss of 10.0 dB over a 100-m length at f = 100 MHz. (a) Find the value of $A_{0}$ and the line resistance per meter at 100 MHz. (b) At the line input, a 10-W power transmitter is attached. At the far end of the line, a 100-$\Omega$ load impedance is attached. How much power is dissipated by the load at frequency 400 MHz?

10.14 [1] A lossless transmission line having characteristic impedance $Z_{0}=50\,\Omega$ is driven by a source at the input end that consists of the series combination of a 10-V sinusoidal generator and a 50-$\Omega$ resistor. The line is one-quarter wavelength long. At the other end of the line, a load impedance $Z_{L}=50-j50\,\Omega$ is attached. (a) Evaluate the input impedance to the line seen by the voltage source-resistor combination. (b) Evaluate the power that is dissipated by the load. (c) Evaluate the voltage amplitude that appears across the load.

10.15 [1] For the transmission line represented in Figure 10.29, find $V_{s,\rm out}$ if f = (a) 60 Hz; (b) 500 kHz.

10.16 [1] A 100-$\Omega$ lossless transmission line is connected to a s

[Truncated for analysis]

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

#### Page 378

Figure 10.34 See Problem 10.30.

10.31 In order to compare the relative sharpness of the maxima and minima of a standing wave, assume a load $z_{L}=4+j0$ is located at $z=0$. Let $\left|V\right|_{\min}=1$ and $\lambda=1$ m. Determine the width of the (a) minimum where $\left|V\right|<1.1$; (b) maximum where $\left|V\right|>4/1.1$.

10.32 In Figure 10.17, let $Z_{L}=250\Omega$ and $Z_{0}=50\Omega$. Find the shortest attachment distance d and the shortest length $d_{1}$ of a short-circuited stub line that will provide a perfect match on the main line to the left of the stub. Express all answers in wavelengths.

10.33 In Figure 10.17, let $Z_{L}=100+j150\Omega$ and $Z_{0}=100\Omega$. Find the shortest length $d_{1}$ of a short-circuited stub and the shortest distance d that it may be located from the load to provide a perfect match on the main line to the left of the stub. (b) Repeat for an open-circuited stub. Express all answers in wavelengths.

10.34 The lossless line shown in Figure 10.35 is operating with $\lambda=100$ cm. If $d_{1}=10$ cm, d=25 cm, and the line is matched to the left of the stub, what is $Z_{L}$?

10.35 A load, $ Z_{L}=25+j75\Omega

[Truncated for analysis]

## Core Ideas

- VSWR determines the magnitude of the reflection coefficient.
- The position of a voltage minimum determines reflection-coefficient phase.
- Input impedance repeats every half wavelength on a lossless line.
- A short circuit provides a reference pattern for determining wavelength and spatial phase.
- Voltage maxima and minima can be used to infer both VSWR and load impedance.
- Cascaded line sections are analyzed from the load toward the source.
- Normalized impedance or admittance is converted back using $Z_0$ or $Y_0$.

## Source Anchors

- Problem 10.21 gives $Z_0=400\,\Omega$, $f=200$ MHz, and $Z_{\mathrm{in}}=200-j200\,\Omega$, and asks for $s$, $Z_L$, and the nearest voltage maximum.
- Problem 10.22 gives VSWR 5.0 and the first voltage minimum at $0.10\lambda$ in front of the load.
- Problem 10.25 uses measured $|V|_{\max}$, $|V|_{\min}$, and their positions to determine $Z_L$.
- Problem 10.29 uses minima spacing of 25 cm under short-circuit replacement and a 7 cm displacement from a marked minimum.
- Problem 10.30 uses a short-circuit reference minimum 16 cm from point X, then a loaded minimum 5 cm from X with maximum-to-minimum ratio 3.
- Figures 10.30, 10.31, 10.32, 10.33, and 10.34 should be retained as S1.P375.F2, S1.P376.F1, S1.P376.F2, S1.P377.F1, and S1.P378.F1 and assigned to their associated network or probe-analysis tasks.

## Related Pages

- [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]
- [[smith-chart-impedance-and-admittance-procedures|Smith-Chart Impedance and Admittance Procedures]]
- [[single-stub-and-reactive-matching|Single-Stub and Reactive Matching]]
- [[charged-line-transients-and-reflection-diagrams|Charged-Line Transients and Reflection Diagrams]]
- [[wave-superposition-and-current-standing-waves|Wave Superposition and Current Standing Waves]]

## Concept Dependencies

- enables: [[smith-chart-impedance-and-admittance-procedures|Smith-Chart Impedance and Admittance Procedures]]
- enables: [[single-stub-and-reactive-matching|Single-Stub and Reactive Matching]]
- depends-on: [[wave-superposition-and-current-standing-waves|Wave Superposition and Current Standing Waves]]
