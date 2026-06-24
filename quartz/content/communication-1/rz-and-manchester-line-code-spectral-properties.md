---
title: "RZ and Manchester line-code spectral properties"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 79", "Page 80", "Page 81", "Page 83"]
related: ["power-spectral-density-as-a-line-code-analysis-tool", "unipolar-and-polar-nrz-spectral-properties", "psd-conversion-for-multilevel-signaling-and-spectral-efficiency"]
tags: ["unipolar-rz", "bipolar-rz", "manchester", "psd", "synchronization", "duty-cycle"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-079-2.png", "/communication-1/assets/communications-1-coursereader-page-080-2.png"]
---

## RZ and Manchester line-code spectral properties

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 79, Page 80, Page 81, Page 83

The chapter extends line-code analysis to return-to-zero and Manchester waveforms, highlighting how pulse structure changes both synchronization behavior and spectral occupancy. Unipolar RZ uses a single supply and returns to zero within each bit interval, which doubles bandwidth relative to NRZ and provides synchronization information. The text also provides a variable-duty-cycle form of the PSD. Bipolar RZ uses positive, zero, and negative levels, requires two power supplies, and has no DC component. Manchester coding has a guaranteed mid-bit transition, which prevents long runs of zeros from causing loss of clock information and also supports a form of error detection when impossible voltage patterns appear. These codes typically trade increased bandwidth for better timing recovery or DC suppression. The PSD formulas show these differences explicitly through sinc terms, impulse train components, and sinusoidal factors that produce spectral nulls and eliminate or reduce low-frequency content.

### Source snapshots

![Communications_1_CourseReader Page 79](/communication-1/assets/communications-1-coursereader-page-079-2.png)

![Communications_1_CourseReader Page 80](/communication-1/assets/communications-1-coursereader-page-080-2.png)

### Page-grounded details

#### Page 79

7.6 Unipolar RZ
Below you may see a visualization of a Unipolar NRZ transmission. Since it is a unipolar
signaling waveform, one power supply is needed. Furthermore, following the analysis of
the PSD, there is a DC component. The effects of 'Returning-to-Zero' are the doubling of
bandwidth, as well as the presence of synchronization information.

PunipolarRZ (f ) = A2Tb
16 sinc2( f Tb
2 )[1 + 1
Tb
P∞
n=-∞ δ(f - n
Tb )] (95)
Note that if we want to use variable duty cycle, the PSD is given as:

PunipolarRZ (f ) = A2d2Tb
4 sinc2(f dTb)[1 + 1
Tb
P∞
n=-∞ δ(f - n
Tb )] (96)
Figure 55: PSD of Unipolar RZ
75

#### Page 80

7.7 Bipolar RZ
Below you may see a visualization of a Bipolar NRZ transmission. Since it is a bipolar
signaling waveform, two power supplies are needed. Furthermore, following the analysis of
the PSD, there is no DC component. Furthermore due to the 'Return-to-Zero' there are
three possible voltage levels to be detected at the receiver (positive, 0, negative).

PbipolarRZ (f ) = A2Tb
4 sinc2( f Tb
2 ) sin2(πf Tb) 	(97)
Figure 56: PSD of Bipolar RZ
76

#### Page 81

7.8 Manchester
Lastly we can observe the Manchester linecode, with the special characteristic that a string
of zero's will not cause loss of the clock signal. Furthermore it allows for error detection,
since we can realize this whenever there are more than two incoming detected voltages (of
transmitted bits) at the same level.
The PSD is given as:




PM anchester(f ) = A2Tbsinc2( f Tb
2 ) sin2( πf Tb
2 ) 	(98)
Figure 57: PSD of Manchester
77

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

- Unipolar RZ returns to zero within each bit interval.
- The return-to-zero property doubles bandwidth and helps synchronization.
- Bipolar RZ has three possible receiver voltage levels: positive, zero, and negative.
- Bipolar RZ has no DC component.
- Manchester coding preserves clock information even during long runs of zeros.
- Manchester can help error detection when impossible voltage patterns are observed.

### Related topics

- [[power-spectral-density-as-a-line-code-analysis-tool|Power spectral density as a line-code analysis tool]]
- [[unipolar-and-polar-nrz-spectral-properties|Unipolar and polar NRZ spectral properties]]
- [[psd-conversion-for-multilevel-signaling-and-spectral-efficiency|PSD conversion for multilevel signaling and spectral efficiency]]

