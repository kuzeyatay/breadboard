---
title: "Working with Decibels for Power, Gain, and SNR"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 145", "Page 146", "Section: 12.1 Working with dB's"]
related: ["free-space-wireless-propagation-and-friis-equation", "knife-edge-diffraction-loss-calculation", "physical-channel-equation-sheet"]
tags: ["dbm", "dbw", "snr", "gain", "power-ratio"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-145-2.png", "/communication-1/assets/communications-1-coursereader-page-146-2.png"]
---

## Working with Decibels for Power, Gain, and SNR

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 145, Page 146, Section: 12.1 Working with dB's

The appendix explains decibels as a logarithmic representation that makes large dynamic ranges manageable and simplifies multiplicative power relationships into addition and subtraction. In this course, the focus is on power quantities, specifically dBW and dBm, which are logarithmic forms of watts and milliwatts. The conversion formulas show how to map linear power to logarithmic units and back. The same logarithmic principle applies to unitless ratios such as gain and signal-to-noise ratio, where the ratio in dB is $10\log_{10}$ of the linear ratio. The appendix emphasizes logarithm identities, especially $\log(AB)=\log A + \log B$ and $\log(A/B)=\log A - \log B$, because these identities justify link-budget arithmetic in dB. A free-space attenuation example is interpreted both as subtracting channel loss in dB and as dividing by attenuation ratio in linear scale. The appendix also includes quick mental-conversion thumb rules for common ratios such as 2 to 3 dB and 4 to 6 dB.

### Source snapshots

![Communications_1_CourseReader Page 145](/communication-1/assets/communications-1-coursereader-page-145-2.png)

![Communications_1_CourseReader Page 146](/communication-1/assets/communications-1-coursereader-page-146-2.png)

### Page-grounded details

#### Page 145

12 Appendix
12.1 Working with dB's
Irrespective of what field you will follow further it is highly probable that you will need to
work with Decibel units. Especially with regards to antenna systems or communications,
they allow us to quickly grasp the scale of a certain power or noise level.
For example, it is easier to compare 76dB with 102dB, rather than their linear counterparts
of 39810717 and 15848931922...
Since the use of Decibel is simply based on the shift from a linear to a logarithmic scale we
can perform this conversion for any unit we want. In textbooks you can hence find dBV
for example which is a conversion of voltage into a logarithmic scale. In this course we
will only discuss the conversion of power into logarithmic scale hence we will discuss dBW
or dBm(watt). These units represent respectively, the conversion of power in Watts and
milliWatts into a logarithmic scale.
When working with power or power ratio's we will use the following forumli to convert
between the linear and dB scale:
PdBm = 10 * log10 PmW att
or:
PdBW = 10 * log10 PW att
If power is given in dBm or dBW one can use the equations below to convert to milliWatts
or Watts respectively:
PmW att(W att)

[Truncated for analysis]

#### Page 146

(Where we have L is an attenuation ratio)
The use of decibels also allows us to quickly estimate the power ratio between two magnitude
as we can use the following thumb rules for conversion:
Ratio dB
2 3
3 5
4 6
5 7
6 8
8 9
For further practice, I suggest checking out: https://greatscottgadgets.com/sdr/3/.
142

### Key points

- dB units express power on a logarithmic scale and simplify comparison across large ranges.
- Power conversions use $$P_{dBm}=10\log_{10}(P_{mW}),\quad P_{dBW}=10\log_{10}(P_W).$$
- Inverse conversion uses powers of ten to recover linear watts or milliwatts.
- Unitless ratios such as gain and SNR also use $10\log_{10}(\cdot)$.
- Log identities turn multiplicative gains and losses into additive dB terms.
- In dB, received power after attenuation can be written as $P_{Rx}=P_{Tx}-L$.
- The appendix provides ratio-to-dB thumb rules for quick estimates.

### Related topics

- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]
- [[physical-channel-equation-sheet|Physical Channel Equation Sheet]]

## Added from [[988934-english-1|Introduction to Decibels, dBm, and dBW in Engineering]]

Source label: upload

Locations: Page 2

The source defines decibels for power ratios using the standard logarithmic expression $$\mathrm{dB} = 10 \log_{10}\left(\frac{P_{out}}{P_{in}}\right).$$ The ratio $P_{out}/P_{in}$ is explicitly described as having no units; it is just a number that compares output power to input power. This is the core formula students are expected to use throughout the course. The lecture applies the formula to simple cases to build intuition. A gain of 10 dB corresponds to a tenfold increase in power, not a hundredfold increase. If the output power is twice the input power, then $10\log_{10}(2) \approx 3$ dB. The source also reverses the reasoning: if a signal is 6 dB higher, the corresponding power ratio is approximately 4, since 6 dB is roughly two successive 3 dB increases. The lecture encourages students to compute these values directly using calculators rather than guessing, because procedural fluency with base-10 logarithms is necessary for exams.

### Source snapshots

![988934_English-1 Page 2](/communication-1/assets/988934-english-1-page-002.png)

### New key points

- For power, decibels are defined by $10 \log_{10}(P_{out}/P_{in})$.
- The ratio $P_{out}/P_{in}$ is unitless.
- A gain of 10 dB corresponds to 10 times more power.
- Doubling power corresponds to about 3 dB.
- A 6 dB increase corresponds to about a factor of 4 in power.
- Students are expected to use calculators for these conversions.
