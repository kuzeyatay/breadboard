---
title: "Relating Input and Output SNR in Digital Communication"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 59", "Page 60"]
related: ["receiver-output-signal-to-noise-ratio-in-pcm", "bit-error-probability-on-awgn-channels", "pcm-bandwidth-requirements", "worked-example-for-required-transmit-power"]
tags: ["snr", "bit-error-probability", "pcm-bandwidth", "quantization-levels", "awgn", "receiver", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-059-2.png", "/communication-1/assets/communications-1-coursereader-page-060-2.png"]
---

## Relating Input and Output SNR in Digital Communication

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 59, Page 60

The text distinguishes between $(S/N)_{in}$, the SNR at the receiver input determined mainly by channel noise, and $(S/N)_{out}$, the SNR after reconstruction determined by both quantization and bit errors. These two are linked through the bit-error probability $P_e$. First, channel conditions determine $(S/N)_{in}$, which determines $P_e$ through the Q-function relation. Then $P_e$, together with the number of quantization levels $M$, determines $(S/N)_{out}$ through the PCM output SNR formula. This means better source quantization alone does not guarantee better reconstructed signal quality, because increasing the number of bits per sample also increases the PCM bandwidth requirement. A wider bandwidth admits more channel noise power for fixed noise spectral density, which can reduce $(S/N)_{in}$ and increase $P_e$. The text explicitly warns that increasing $n$ may seem beneficial because quantization gets finer, but the higher occupied bandwidth can offset this gain. Figure 46 illustrates this trade-off across different $M$ values, showing output SNR as a function of bit-error probability. The durable concept is that end-to-end digital quality depends on a balance between source resolution and channel error performance, not on either factor in isolation.

### Source snapshots

![Communications_1_CourseReader Page 59](/communication-1/assets/communications-1-coursereader-page-059-2.png)

![Communications_1_CourseReader Page 60](/communication-1/assets/communications-1-coursereader-page-060-2.png)

### Page-grounded details

#### Page 59

Probability of error =
(Probability of message 0) * (Probability that message 0 falls in the wrong region (so higher than VT ))
+(Probability of message 1) * (Probability that message 1 falls in the wrong region (so lower then VT )
(81)
Which mathematically can be described as
Pe = Pr(0) * P (x > VT |0) + Pr(1) * Pr(x < VT |1) (82)
Supposing that we are equally likely to receive a 0 or 1, and by using the Q-function we
can write Pe as
Pe = 1
2 Q( VT - V0
σ ) + 1
2 Q( V1 - VT
σ ) (83)
which finally can be expressed as (derivation out of the scope of the course):


Pe = Q
q
( S
N )in

(84)
Equation (84) relates the probability of error with the SNR at the input of the receiver.
5.5.7 Relating SNRin and SNRout
The (SN R)in is the SNR of the received signal at the input of the receiver stage, which
mainly deals with the channel noise (AWGN)
Furthermore, the SN Rout is the SNR at the output of the receiver, which is dependent on
how the initial signal was quantized (via the term M 2) but also how the digital signal was
received (via the term Pe).
+
PHYSICAL CHANNEL
(wired or wireless)
Noise (AWGN)
Signal 	Noisy
	signal
TRANSMITTER
Hello world
RECEIVER
Message
Hello world
Probability

[Truncated for analysis]

#### Page 60

P e
M = 4096 (n = 12)
M = 1024 (n = 10)
M = 256 (n = 8)
M = 64 (n = 6)
M = 8 (n = 3)
M = 4 (n = 2)
10 6 	10 5 	10 4 	10 3 	10 2 	10 1 	1.0	10 7
0
10
20
30
40
50
60
70
80
(S/N)
 pk ou
t= peak signal power to average noise power out (dB)
Figure 46: SN Rout of a PCM system as a function of Pe and the number of quantizer steps M
Exercise 3: Computing required transmit power
Suppose we have a digital communication system, for which an audio signal with a
bandwidth of 20 kHz is being transmitted. The signal is quantized on the transmitter
side using an A/D converter of 10 bits per level (n = 10), and sampled at a sampling
frequency fs = 44.1 kHz.
After some experimentation, it was found that the channel has a noise spectral
density of No
2 = 10-8 W/Hz. Furthermore, assume spectral efficiency η = 1.
At the receiver, it is required that SN Rout = 30 dB. Compute the transmit power
of the transmitter antenna to be used to meet the system requirements.
Solution: In order to find the required transmit power to achieve the required
SN Rout, we need to start from the end of the communication chain and work
backwards. That is, we first find minimum Pe needed, and then using Pe we can
compute a SN

[Truncated for analysis]

### Key points

- $(S/N)_{in}$ is governed mainly by channel noise before detection.
- $(S/N)_{out}$ depends on quantization level and bit-error probability.
- $P_e$ connects input SNR to output SNR.
- Increasing bits per sample improves quantization but increases required bandwidth.
- Greater bandwidth can increase received noise power for a fixed noise PSD.
- Therefore raising $n$ does not always improve final reconstructed SNR.

### Related topics

- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- [[bit-error-probability-on-awgn-channels|Bit Error Probability on AWGN Channels]]
- [[pcm-bandwidth-requirements|PCM Bandwidth Requirements]]
- [[worked-example-for-required-transmit-power|Worked Example for Required Transmit Power]]

### Relationships

- depends-on: [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- depends-on: [[bit-error-probability-on-awgn-channels|Bit Error Probability on AWGN Channels]]
