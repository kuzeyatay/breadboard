---
title: "1.197 Smith Chart Motion Along a Lossless Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 352", "Page 353", "Page 354", "Page 355"]
related: ["reading-reflection-coefficient-from-the-smith-chart", "smith-chart-locations-of-voltage-extrema-and-vswr", "slotted-line-determination-of-an-unknown-load", "smith-chart-impedance-and-reflection-coefficient-mapping"]
---

# 1.197 Smith Chart Motion Along a Lossless Line

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 352, Page 353, Page 354, Page 355

Dividing the total line voltage by $Z_0$ times the total current gives the normalized input impedance. At a distance $l$ toward the generator from the load, the result is
$$
z_{\mathrm{in}}=\frac{1+\Gamma e^{-j2\beta l}}{1-\Gamma e^{-j2\beta l}}=\frac{1+|\Gamma|e^{j(\phi-2\beta l)}}{1-|\Gamma|e^{j(\phi-2\beta l)}}
$$
 Moving along a lossless line therefore rotates the reflection coefficient without changing its magnitude. Travel toward the generator decreases the reflection angle, so it is represented by clockwise movement on a constant-$|\Gamma|$ circle. A full revolution occurs for $l=\lambda/2$, which expresses the half-wavelength periodicity of input impedance. Example 10.10 starts from $z_L=0.5+j1$ at a wavelengths-toward-generator reading of 0.135. Adding $l/\lambda=0.300$ gives 0.435, where the chart reads $z_{\mathrm{in}}=0.28-j0.40$. Thus $Z_{\mathrm{in}}=14-j20\ \Omega$, close to the analytical value $13.7-j20.2\ \Omega$.

## Page-Grounded Details

#### Page 352

Figure 10.12 The Smith chart contains the constant-r circles and constant-x circles, an auxiliary radial scale to determine |Γ|, and an angular scale on the circumference for measuring φ.

angle is indicated on the circumference of the circle. A straight line from the origin through the intersection may be extended to the perimeter of the chart. As an example, if $Z_{L}=25+j50\ \Omega$ on a 50-$\Omega$ line, $z_{L}=0.5+j1$, and point $A$ on Figure 10.12 shows the intersection of the $r=0.5$ and $x=1$ circles. The reflection coefficient is approximately 0.62 at an angle $\phi$ of $83^{\circ}$.

The Smith chart is completed by adding a second scale on the circumference by which distance along the line may be computed. This scale is in wavelength units, but the values placed on it are not obvious. To obtain them, we first divide the voltage at any point along the line,
$$
V_{s}=V_{0}^{+}(e^{-j\beta z}+\Gamma\,e^{j\beta z})
$$
by the current
$$
I_{s}=\frac{V_{0}^{+}}{Z_{0}}(e^{-j\beta z}-\Gamma\,e^{j\beta z})
$$
obtaining the normalized input impedance
$$
z_{\mathrm{in}}=\frac{V_{s}}{Z_{0}I_{s}}=\frac{e^{-j\beta z}+\Gamma\,e^{j\beta z}}{e^{-j\beta z}-\Gamma\,e^{j\b

[Truncated for analysis]

#### Page 353

line length
$$
 z_{\rm in}=\frac{1+\Gamma e^{-j2\beta l}}{1-\Gamma e^{-j2\beta l}}=\frac{1+|\Gamma| e^{j(\phi-2\beta l)}}{1-|\Gamma| e^{j(\phi-2\beta l)}}\quad{(114)}
$$
Note that when $l=0$, we are located at the load, and $z_{\rm in}=(1+\Gamma)/(l-\Gamma)=z_{L}$, as shown by (107).

Equation (114) shows that the input impedance at any point $z=-l$ can be obtained by replacing $\Gamma$, the reflection coefficient of the load, with $\Gamma\ e^{-j2\beta l}$. That is, we decrease the angle of $\Gamma$ by $2\beta l$ radians as we move from the load to the line input. Only the angle of $\Gamma$ is changed; the magnitude remains constant.

Thus, as we proceed from the load $z_{L}$ to the input impedance $z_{\rm in}$, we move toward the generator a distance l on the transmission line, but we move through a clockwise angle of $2\beta l$ on the Smith chart. Since the magnitude of $\Gamma$ stays constant, the movement toward the source is made along a constant-radius circle. One lap around the chart is accomplished whenever $\beta l$ changes by $\pi$ rad, or when l changes by one-half wavelength. This agrees with our earlier discovery that the input impedance of

[Truncated for analysis]

#### Page 354

Figure 10.13 A photographic reduction of one version of a useful Smith chart (Source: Emeloid Company, Hillside, NJ.) For accurate work, larger charts are available wherever fine technical books are sold.

Source: The Emeloid Company, Hillside, NJ.

must occur at the load when $Z_{L}$ is a pure resistance; if $R_{L}>Z_{0}$ there is a maximum at the load, and if $R_{L}<Z_{0}$ there is a minimum. We may extend this result now by noting that we could cut off the load end of a transmission line at a point where the input impedance is a pure resistance and replace that section with a resistance $R_{\rm in}$; there would be no changes on the generator portion of the line. It follows, then, that the location of voltage maxima and minima must be at those points where $Z_{\rm in}$ is a pure resistance. Purely resistive input impedances must occur on the $x=0$ line (the $\Gamma_{r}$ axis) of the Smith chart. Voltage maxima or current minima occur when $r>1$, or at wtg = 0.25, and voltage minima or current maxima occur when $r<1$, or at wtg = 0.

#### Page 355

Figure 10.14 Normalized input impedance produced by a normalized load impedance $z_{L}=0.5+j1$ on a line 0.3$\lambda$ long is $z_{\mathrm{in}}=0.28-j0.40$.

In Example 10.10, then, the maximum at $\mathrm{wtg}=0.250$ must occur $0.250-0.135=0.115$ wavelengths toward the generator from the load. This is a distance of $0.115\times 200$, or 23 cm from the load.

We should also note that because the standing wave ratio produced by a resistive load $R_{L}$ is either $R_{L}/R_{0}$ or $R_{0}/R_{L}$, whichever is greater than unity, the value of $s$ may be read directly as the value of $r$ at the intersection of the $|\Gamma|$ circle and the $r$ axis, $r>1$. In our example, this intersection is marked point $C$, and $r=4.2$; thus, $s=4.2$.

Transmission line charts may also be used for normalized admittances, although there are several slight differences in such use. We let $y_{L}=Y_{L}/Y_{0}=g+jb$ and use the $r$ circles as $g$ circles and the $x$ circles as $b$ circles. The two differences are, first, the line segment where $g>1$ and $b=0$ corresponds to a voltage minimum; and second, $180^{\circ}$ must be added to the angle of $\Gamma$

[Truncated for analysis]

## Core Ideas

- Use
$$
z_{\mathrm{in}}=\frac{1+\Gamma e^{-j2\beta l}}{1-\Gamma e^{-j2\beta l}}.$$
- Moving toward the generator replaces $\Gamma$ by $\Gamma e^{-j2\beta l}$.
- Lossless-line movement preserves $|\Gamma|$.
- Toward-generator travel is clockwise on the Smith chart.
- One complete Smith chart revolution corresponds to $\lambda/2$.
- Wavelength-scale readings wrap modulo 0.5.
- Denormalize with $Z_{\mathrm{in}}=Z_0z_{\mathrm{in}}$.

## Source Anchors

- Pages 352 and 353 derive normalized input impedance from the traveling-wave voltage and current.
- Page 353 gives the transformation as Eq. (114).
- Page 353 states that only the angle of $\Gamma$ changes along a lossless line.
- Page 353 identifies clockwise travel as movement toward the generator.
- Source figure S1.P354.F1, Figure 10.13, supplies clockwise and counterclockwise wavelength scales.
- Pages 353 and 355, with source figure S1.P355.F1, Figure 10.14, transform $z_L=0.5+j1$ through $0.3\lambda$ to approximately $z_{\mathrm{in}}=0.28-j0.40$.

## Related Pages

- [[reading-reflection-coefficient-from-the-smith-chart|Reading Reflection Coefficient from the Smith Chart]]
- [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
- [[slotted-line-determination-of-an-unknown-load|Slotted-Line Determination of an Unknown Load]]
- [[smith-chart-impedance-and-reflection-coefficient-mapping|Smith Chart Impedance and Reflection-Coefficient Mapping]]

## Concept Dependencies

- derives-from: [[smith-chart-impedance-and-reflection-coefficient-mapping|Smith Chart Impedance and Reflection-Coefficient Mapping]]
- enables: [[smith-chart-locations-of-voltage-extrema-and-vswr|Smith Chart Locations of Voltage Extrema and VSWR]]
