---
title: "Power-Limited and Bandwidth-Limited Channel Operation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 101", "Page 102"]
related: ["shannon-hartley-channel-capacity-theorem", "minilab-on-shannon-capacity-exploration", "instruction-exercises-on-information-theory"]
tags: ["snr", "bandwidth-limited-region", "power-limited-region", "channel-capacity", "shannon-hartley-theorem"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-101-2.png", "/communication-1/assets/communications-1-coursereader-page-102-2.png"]
---

## Power-Limited and Bandwidth-Limited Channel Operation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 101, Page 102

The capacity curve implied by the Shannon-Hartley theorem reveals two qualitatively different operating regions. In the power-limited region, where $\mathrm{SNR} \ll 1$, capacity is constrained mainly by insufficient signal strength relative to noise. In that regime, increasing SNR can strongly improve the achievable data rate. In contrast, in the bandwidth-limited region, where $\mathrm{SNR} \gg 1$, the channel already has abundant SNR and the main bottleneck becomes the available bandwidth. Because the logarithm changes slowly at high SNR, adding more signal power gives only small capacity gains, so more bandwidth is needed to support substantially higher data rates. The chapter uses Figure 75 to visualize these domains and explicitly concludes that capacity saturates with respect to SNR in the high-SNR regime. This distinction is important for communication-system design because it determines whether engineering effort should be focused on stronger signals, lower noise, or wider bandwidth allocation.

### Source snapshots

![Communications_1_CourseReader Page 101](/communication-1/assets/communications-1-coursereader-page-101-2.png)

![Communications_1_CourseReader Page 102](/communication-1/assets/communications-1-coursereader-page-102-2.png)

### Page-grounded details

#### Page 101

-10 	0 	10 	20 	30 	40 	50 	60
SNR (dB)
102
103
104
Capacity (bits per second)
Error-free transmission
Transmission with
errors
Bandwidth
limited region
SNR >> 1
Power limited
region
SNR << 1
Figure 75: Shannon-Hartley channel capacity equation plotted for SNR -10 dB to 60 dB, with a
channel bandwidth of 1 kHz
9.3 Shannon-Hartley channel capacity theorem
The Shannon-Hartley capacity theorem defines the upper limit for the rate at which in-
formation in bits per second can be sent, error-free, over a communication channel with
a certain bandwidth and signal power in the presence of noise. The equation is defined
as 



C = B log2(1 + SN R) [bits/s] 	(118)
where C is the channel capacity (bits/s), B is the channel bandwidth (Hz) and SNR is
the signal-to-noise ratio of the channel. The maximum spectral efficiency is then defined
as
ηmax = C
B = log2(1 + SN R) (119)
Equation 118 is plotted in Fig. 75.
We observe a linear relationship between bandwidth and data rate, as well as a logarith-
mic relationship between signal power and baud rate. In Fig. 75, two distinct regions are
observed: the bandwidth-limited region and the power-limited region. The power-
limited region occurs when

[Truncated for analysis]

#### Page 102

Minilab exercise 9.1 - Shannons channel capacity theorem
This mini-lab exercise requires you to use Mini-lab 5 - Information Theory on MAT-
LAB.
In this minilab exercise, we will explore the Shannon-Hartley channel capacity the-
orem and its implications.
- 1) Leave the default settings. Try to identify where is the SNR-limited region
in the channel capacity plot, and the bandwidth-limited region.
- 2) Change the noise spectral density (No/2, under the channel settings tab),
to a value of 0.1, and click update settings. What do you see now? Is the
system operating in a bandwidth-limited region or SNR-limited region?
- 3) Assume you are designing a telecommunication system for a smartphone,
and you want to achieve a bitrate of 10 Mbps (107 bits per second). The
channel noise spectral density between the smartphone and the base station is
on average 10-8. As a smartphone designer, the transmit power is constrained
up to a maximum of 0.25 watts. What bandwidth do you need to achieve this
transmission rate considering the transmission power limitations?
- 4) What happens with the SNR range? Does it decrease or increase when
you increase the bandwidth? Explain why this happens. [overlay

[Truncated for analysis]

### Key points

- The power-limited region occurs when $\mathrm{SNR} \ll 1$.
- The bandwidth-limited region occurs when $\mathrm{SNR} \gg 1$.
- In the power-limited region, insufficient SNR constrains capacity.
- In the bandwidth-limited region, available bandwidth constrains capacity.
- Capacity responds strongly to SNR increases at low SNR.
- Capacity responds weakly to SNR increases at high SNR.
- At high SNR, more bandwidth is needed to send significantly more information.

### Related topics

- [[shannon-hartley-channel-capacity-theorem|Shannon-Hartley Channel Capacity Theorem]]
- [[instruction-exercises-on-information-theory|Instruction Exercises on Information Theory]]

### Relationships

- depends-on: [[shannon-hartley-channel-capacity-theorem|Shannon-Hartley Channel Capacity Theorem]]
