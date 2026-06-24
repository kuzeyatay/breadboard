---
title: "Bit Error Probability on AWGN Channels"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 57", "Page 58", "Page 59"]
related: ["q-function-as-gaussian-tail-probability", "additive-white-gaussian-noise-model", "receiver-output-signal-to-noise-ratio-in-pcm", "relating-input-and-output-snr-in-digital-communication"]
tags: ["bit-error-probability", "awgn", "q-function", "threshold-voltage", "receiver", "snr", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-057-2.png", "/communication-1/assets/communications-1-coursereader-page-058-2.png"]
---

## Bit Error Probability on AWGN Channels

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 57, Page 58, Page 59

The bit-error probability section explains how threshold detection of binary levels becomes probabilistic in the presence of AWGN. The receiver uses a threshold voltage $V_T$ between the voltage assigned to bit 0 and the voltage assigned to bit 1. Noise can push a received 0 above the threshold or pull a received 1 below it, causing a decision error. The text models each received bit value as a Gaussian distribution centered at its nominal voltage, with spread determined by the noise variance. The error probability is then the weighted sum of the probabilities that each symbol lands in the wrong decision region: $$P_e = \Pr(0)\Pr(x>V_T\mid 0)+\Pr(1)\Pr(x<V_T\mid 1).$$ Assuming equally likely 0 and 1 symbols, this becomes $$P_e = \frac{1}{2}Q\!\left(\frac{V_T-V_0}{\sigma}\right)+\frac{1}{2}Q\!\left(\frac{V_1-V_T}{\sigma}\right).$$ The text then presents a simplified final relation, stated without full derivation, $$P_e = Q\!\left(\sqrt{(S/N)_{in}}\right),$$ linking bit-error probability directly to the receiver input SNR. This provides the key bridge from channel noise power to detection performance.

### Source snapshots

![Communications_1_CourseReader Page 57](/communication-1/assets/communications-1-coursereader-page-057-2.png)

![Communications_1_CourseReader Page 58](/communication-1/assets/communications-1-coursereader-page-058-2.png)

### Page-grounded details

#### Page 57

5.5.6 Computing Bit-error probability on AWGN channels
Now that we have covered simple probability theory, q-function, and AWGN, we may finally
formulate a method to compute the bit-error probability Pe of AWGN channels. Suppose
we have a channel that is affected by AWGN noise and you want to transmit the binary
sequence '01001110. At the receiver, the signal will arrive noisy, and to decode the message,
you may define a threshold voltage at 0.5V between 1V and 0V, and any voltage higher than
the threshold voltage may be considered as the message '1' and any voltage lower than the
threshold voltage may be considered as message '0'. See Fig. 41 for visualizations.
0 	1 	0 	0 	1 	1 	1 	0
Figure 41: Received noisy signal with binary message 01001110, and a threshold voltage VT in the
center to decode the message
However, if you look closely at the image you may spot two cases (see the red arrows inside
the plot Fig. 41), where the message was 0, however because of noise, the voltage of the
signal spiked higher than the threshold voltage VT . This is considered an error due to noise
because it can cause the decoder to wrongly decode the message (0 instead of 1, or vice
versa). Now to q

[Truncated for analysis]

#### Page 58

0 	1 	0 	0 	1 	1 	1 	0
ERROR!
0V
-0.5V
-1V
0.5V
1V
1.5V
2V
Probability density
of received voltage
Figure 42: Illustration of the probability distribution of AWGN noise of message 0, showcasing
that the Gaussian distribution tail of the noise which exceeds the decision region, represents the
probability that an error will occur (hence the message falling into the wrong region)
Now if we also plot the Gaussian distribution of message '1' centered around 1V then we
get the
0 	1 	0 	0 	1 	1 	1 	0
ERROR!
0V
-0.5V
-1V
0.5V
1V
1.5V
2V
Probability density
of received voltage
Figure 43: Illustration of the probability distribution of AWGN noise for both messages 0 and 1
ERROR!
0V 	-0.5V 	-1V	0.5V	1V	1.5V
	2V
Probability density
of received voltage
Figure 44: The probability distributions of the messages under AWGN noise
To find the probability of error Pe, we can formulate the problem as
54

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

### Key points

- A receiver decides bits by comparing the noisy voltage to a threshold $V_T$.
- Errors occur when noise pushes a symbol into the wrong decision region.
- The received level for each bit is modeled as a Gaussian distribution.
- The general error formula weights conditional tail probabilities by symbol probabilities.
- For equally likely bits, the formula is expressed using two Q-functions.
- The final simplified relation is $P_e = Q\!\left(\sqrt{(S/N)_{in}}\right)$.

### Related topics

- [[q-function-as-gaussian-tail-probability|Q-Function as Gaussian Tail Probability]]
- [[additive-white-gaussian-noise-model|Additive White Gaussian Noise Model]]
- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- [[relating-input-and-output-snr-in-digital-communication|Relating Input and Output SNR in Digital Communication]]

### Relationships

- depends-on: [[relating-input-and-output-snr-in-digital-communication|Relating Input and Output SNR in Digital Communication]]
