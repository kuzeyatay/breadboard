---
title: "Noise sensitivity tradeoff in multilevel signaling"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 69", "Page 70"]
related: ["multilevel-signaling-concept-and-efficiency", "baud-rate-and-bit-rate-relationships", "mini-lab-5-2-communication-chain-and-robustness-comparison", "mini-lab-6-1-multilevel-signaling-procedure"]
tags: ["multilevel-signaling", "polar-nrz", "noise", "decoding-errors", "binary-signaling", "lab-2"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-069-2.png", "/communication-1/assets/communications-1-coursereader-page-070-2.png"]
---

## Noise sensitivity tradeoff in multilevel signaling

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 69, Page 70

Although multilevel signaling improves spectral efficiency, it makes detection more vulnerable to noise because the allowed amplitude levels are more closely spaced. The text illustrates this with 4-level Polar NRZ signaling, where under low noise the received waveform still clusters around the expected amplitudes and accurate decoding remains possible. Under high noise, however, the received amplitude can shift enough to cross decision boundaries, causing the decoded bit sequence to differ from the transmitted one. The chapter then contrasts this with binary signaling, where only two levels exist. With the same strong noise, the larger spacing between the two decision regions makes it easier to infer whether a 1 or 0 was sent. This section teaches the central limitation of multilevel modulation: increasing bits per symbol improves throughput and may reduce bandwidth for a given bit rate, but it reduces noise margin. In practice, channel conditions determine how many levels can be used reliably.

### Source snapshots

![Communications_1_CourseReader Page 69](/communication-1/assets/communications-1-coursereader-page-069-2.png)

![Communications_1_CourseReader Page 70](/communication-1/assets/communications-1-coursereader-page-070-2.png)

### Page-grounded details

#### Page 69

and measure the amount of symbols with the unit symbol rate.
Figure 48: Figure illustrating the conversion of a digital transmission from 2 levels to 4 levels,
showing that you can transmit the same amount of information in a faster time.
We define l as the number of bits per level, meaning the number of bits each level
represents, and L as the number of levels. l and L are related as




L = 2l or l = log2 (L) 	(85)
Moreover, with multilevel signaling, less bandwidth is needed for the same information
transfer capacity (is symbol rate remains unchanged) or more information can be sent at
the same time, if we increase the number of bits each symbol carries.
6.3.1 Advantages and Disadvantages of multilevel signaling
Using multiple bits per level can increase our data transmission rate. It would seem rea-
sonable that increasing the number of levels to a very high number is the next logical
step.
However, we must be aware of channel effects, and how this will affect what we obtain at
the other end of our communication link, so at the input of the receiver.
For example we can simulate the effects of noise, on both the case where l = 1 (so "one
bit per symbol" transmission), and th

[Truncated for analysis]

#### Page 70

0	0.5	1	1.5	2	2.5	3	3.5	4
Time
-2
-1.5
-1
-0.5
0
0.5
1
1.5
2
Amplitude
Polar NRZ Transmission with Noise
Expected amplitude for 11
Expected amplitude for 10
Expected amplitude for 01
Expected amplitude for 00
Figure 49: 4-level (2-bit) polar NRZ transmission under low noise-distinct amplitude levels allow
accurate decoding.
As we can see in Figure above, there are 4 possible levels the amplitude can take (corre-
sponding to all possible combinations of two bits).
We see that when the noise magnitude is small (minor variations in the waveform), we can
still easily tell which combination of bits was sent. This is because the amplitude of the
incoming waveform, whilst time-variant, stays relatively close to the expected level.
In figure, the effect of noise is stronger. In fact it is sufficiently harsh that at the receiver,
the bit sequence decoded will most likely not coincide with what was actually sent.
0 	0.5 	1 	1.5 	2 	2.5 	3 	3.5 	4
Time
-2
-1.5
-1
-0.5
0
0.5
1
1.5
2
Amplitude
Polar NRZ Transmission with Noise
Figure 50: 4-level polar NRZ transmission under high noise-amplitude distortions lead to decoding
errors.
Now if we instead go back l = 1, so one bit per symbol, we see t

[Truncated for analysis]

### Key points

- More levels mean smaller amplitude spacing between valid symbols.
- Low-noise 4-level signaling can still be decoded accurately.
- High-noise 4-level signaling leads to likely decoding errors.
- Binary signaling with $l = 1$ has only two levels and larger decision margins.
- The practical use of multilevel signaling is limited by channel effects and receiver detectability.

### Related topics

- [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
- [[mini-lab-5-2-communication-chain-and-robustness-comparison|Mini-lab 5.2 communication chain and robustness comparison]]
- [[mini-lab-6-1-multilevel-signaling-procedure|Mini-lab 6.1 multilevel signaling procedure]]

### Relationships

- limits: [[multilevel-signaling-concept-and-efficiency|Multilevel signaling concept and efficiency]]
- applies-to: [[mini-lab-6-1-multilevel-signaling-procedure|Mini-lab 6.1 multilevel signaling procedure]]
