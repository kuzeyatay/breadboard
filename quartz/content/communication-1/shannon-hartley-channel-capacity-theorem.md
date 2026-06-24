---
title: "Shannon-Hartley Channel Capacity Theorem"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 100", "Page 101"]
related: ["power-limited-and-bandwidth-limited-channel-operation", "information-theory-motivation-and-error-control-need", "instruction-exercises-on-information-theory"]
tags: ["shannon-hartley-theorem", "channel-capacity", "spectral-efficiency", "snr", "bandwidth"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-100-2.png", "/communication-1/assets/communications-1-coursereader-page-101-2.png"]
---

## Shannon-Hartley Channel Capacity Theorem

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 100, Page 101

The Shannon-Hartley theorem gives the maximum theoretical rate at which information can be transmitted error-free over a noisy channel with finite bandwidth. In this chapter, capacity is defined as a function of channel bandwidth $B$ and signal-to-noise ratio $\mathrm{SNR}$. The theorem establishes a fundamental upper bound rather than a practical coding recipe: no communication scheme can reliably exceed this rate on the same channel. The text emphasizes that capacity grows linearly with bandwidth but only logarithmically with SNR, so increasing transmitted power yields diminishing returns compared with increasing bandwidth when SNR is already high. A related quantity, the maximum spectral efficiency, is obtained by dividing capacity by bandwidth. The chapter frames this theorem as central to digital communications because noise causes bit errors, and capacity tells us the maximum rate at which those errors can in principle be made arbitrarily small. The accompanying figure plots capacity for a 1 kHz channel over a wide SNR range and visually motivates the distinction between different operating regimes.

### Source snapshots

![Communications_1_CourseReader Page 100](/communication-1/assets/communications-1-coursereader-page-100-2.png)

![Communications_1_CourseReader Page 101](/communication-1/assets/communications-1-coursereader-page-101-2.png)

### Page-grounded details

#### Page 100

9 Information theory
9.1 Learning objectives
Students completing this chapter should have learned:
1. Understand the fundamental limit for channel capacity based on the Shannon-Hartley
Theorem.
2. Can calculate the maximum theoretical capacity of a channel based on the bandwidth
and the SNR.
3. Understand the difference between power limited and bandwidth limited modes of
operation for a communication channel.
4. Can calculate a parity bit for a simple case of digital word transmission.
5. Understands the concept of Hamming distance and can use Hamming(7,4) coding to
detect and correct single bit errors.
9.2 Motivation
This section first introduces a maximum theoretical upper bound on the total amount of
information (in bits) that can be sent reliably through a channel, given the bandwidth
and SNR. This upper bound is known as Shannon-Hartley capacity theorem, and is a very
important theorem in the field of digital communications. As we have observed, nearly every
signal, when transmitted through a channel, undergoes corruption from noise, resulting in
a probability of error (or bit flip) greater than zero. If the chance that the incoming digital
data will contain a bit of flip due

[Truncated for analysis]

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

### Key points

- Channel capacity is the theoretical upper limit for error-free transmission rate.
- The theorem applies to a channel with finite bandwidth and noise.
- Capacity is given by $C = B\log_2(1+\mathrm{SNR})$ in bits per second.
- Maximum spectral efficiency is $\eta_{\max} = C/B = \log_2(1+\mathrm{SNR})$.
- Capacity increases linearly with bandwidth.
- Capacity increases logarithmically with SNR.
- The theorem defines a limit, not a specific implementation method.

### Related topics

- [[power-limited-and-bandwidth-limited-channel-operation|Power-Limited and Bandwidth-Limited Channel Operation]]
- [[information-theory-motivation-and-error-control-need|Information Theory Motivation and Error Control Need]]
- [[instruction-exercises-on-information-theory|Instruction Exercises on Information Theory]]

