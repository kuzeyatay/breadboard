---
title: "PSD conversion for multilevel signaling and spectral efficiency"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 82", "Page 83"]
related: ["multilevel-signaling-concept-and-efficiency", "baud-rate-and-bit-rate-relationships", "power-spectral-density-as-a-line-code-analysis-tool"]
tags: ["multilevel-signaling", "spectral-efficiency", "symbol-period", "polar-nrz", "line-codes"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-082-2.png", "/communication-1/assets/communications-1-coursereader-page-083-2.png"]
---

## PSD conversion for multilevel signaling and spectral efficiency

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 82, Page 83

When moving from binary signaling to multilevel signaling, the PSD and efficiency analysis must be adjusted because the symbol period changes. The text gives the relationship $D = 1/T_s = 1/(lT_b) = R/l$, which means that increasing bits per symbol lengthens the symbol period relative to the bit interval and lowers the symbol rate for a fixed bit rate. The general PSD remains expressed through the pulse spectrum and the autocorrelation sequence, but now with symbol period $T_s$ instead of bit period $T_b$. An explicit example is given for 8-level Polar NRZ, where $l = 3$ so $T_s = 3T_b$, leading to a pulse spectrum scaling of $3T_b\,\mathrm{sinc}^2(3T_bf)$. The section also provides a table of spectral efficiencies for common line codes, showing, for example, efficiency 1 for Unipolar NRZ and Polar NRZ, and $1/2$ for Unipolar RZ and Manchester when $l=1$. This section connects multilevel signaling directly to channel efficiency calculations.

### Source snapshots

![Communications_1_CourseReader Page 82](/communication-1/assets/communications-1-coursereader-page-082-2.png)

![Communications_1_CourseReader Page 83](/communication-1/assets/communications-1-coursereader-page-083-2.png)

### Page-grounded details

#### Page 82

7.9 Power spectra for multilevel signaling
Note that when moving towards l (bits per symbol) larger than unity (so any multilevel
signal), we must also make the conversion for the PSD. This is additional to the conversion
required for the spectral efficiency.
Hence we combine with the following:
D = 1
Ts
= 1
lTb
= R
l (99)
Ps(f ) = ||F (f )|2
Ts
∞	X
k=-∞
R(k)ej2πkf Ts (100)
Obtaining thus that for a 8-level Polar NRZ signaling, l = 3 and as such Ts = 3Tb.
|F (f )|2
Ts
= T 2
s sinc2(f Ts)
Ts
= 3Tbsinc2(3Tbf ) (101)
7.10 Spectral efficiency of linecodes
The table below gives the spectral efficiency for different lines codes assuming l=1 or that
D=R.
TA BLE 3-6 SPECTRAL EFFICIENCIES OF LINE CODES
Code Type
First Null Bandwidth
(Hz)
Spectral Efficiency
h = R B [(bits/s)/Hz]
Unipolar NRZ 	R 	1
Polar NRZ 	R 	1
Unipolar RZ 	2R 1
2
Bipolar RZ 	R 	1
Manchester NRZ 	2R 1
2
Multilevel polar NRZ 	R
78

#### Page 83

Tb
- A
- A
(a) Punched Tape
(b) Unipolar NRZ
(c) Polar NRZ
(d) Unipolar RZ
(e) Bipolar RZ
(f) Manchester NRZ
1
mark
(hole)
Volts
Time
1
mark
(hole)
0
space 	space 	space
1
BINARY DATA
mark
(hole)
0 	0 	1
mark
(hole)
- A
A
A
A
A
A
0
0
0
0
0
Figure 58: Summary of all line codes in this chapter
79

### Key points

- For multilevel signaling, symbol period becomes $T_s = lT_b$.
- The symbol rate becomes $D = 1/T_s = R/l$.
- PSD formulas must use the symbol period rather than the bit period.
- An 8-level Polar NRZ system has $l = 3$ and $T_s = 3T_b$.
- The chapter tabulates spectral efficiencies for several line codes.
- RZ and Manchester have lower spectral efficiency than NRZ when $l = 1$.

### Related topics

- [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
- [[power-spectral-density-as-a-line-code-analysis-tool|Power spectral density as a line-code analysis tool]]

### Relationships

- applies-to: [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- depends-on: [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
