---
title: "ISI and Noise"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["physical-channel", "raised-cosine-nyquist-filtering", "error-sources-and-error-correction-in-communication", "physical-receiver"]
tags: ["isi", "noise", "signal", "noisy-signal", "raised-cosine-filter"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## ISI and Noise

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

The topic map identifies ISI and noise as channel impairments that act on the transmitted signal. A small block diagram shows a "Signal" entering a region labeled "ISI + Noise" and emerging as a "Noisy signal." ISI, or intersymbol interference, is therefore presented as an effect that degrades communication by interfering with the clean signal during transmission. Noise is shown together with ISI, indicating that the receiver must cope with both deterministic or waveform-related distortion and random disturbance. The map places this impairment concept near the raised-cosine filter label, implying that filtering is part of the course treatment of ISI. These impairments motivate later receiver operations including PCM decoding, error detection, correction, and signal reconstruction.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### Page-grounded details

#### Page 1

Sampling
(Analog-to-digital
conversion)
Quantization
(Digitization) PCM Signaling
(Line coding)
Modulation
(optional step)
Physical transmission
(ex. antenna or fiber optic)
PHYSICAL CHANNEL
Physical receiver
(ex. antenna
or fiber optic)
TRANSMITTER
RECEIVER
PCM Decoding 	Error detection
and correction
Signal reconstruction
(Digital-to-analog)
Message
101
010
110
001
010 	101011010
1 0 1 0 1 1 0 1 0 	1 0 1 0 1 1 0 1 0
or
Message
(wired or wireless)
V_t 	1
0
001011011
001011011
Error detected
101011010
DAC	101011010
LPF
Hello world
Hello world
Communications 1 (5ETC0)
Topic Map
Raised-cosine filter 	ISI
+
Noise
Signal
Noisy
signal
STARTS FROM
HERE
B,C 	D,E 	E 	i,H 	J,K
J,K 	D,E 	G 	B,C
F,J,K

### Key points

- ISI and noise are shown as impairments in the physical channel.
- The diagram represents a clean "Signal" becoming a "Noisy signal."
- ISI is displayed next to a raised-cosine filter label.
- Noise is combined with ISI using "ISI + Noise."
- These impairments explain why receiver processing must detect and correct errors.
- The concept is associated with topic letters F,J,K in the map.

### Related topics

- [[physical-channel|Physical Channel]]
- [[raised-cosine-nyquist-filtering|Raised-Cosine Filter]]
- [[error-sources-and-error-correction-in-communication|Error Detection and Correction]]
- [[physical-receiver|Physical Receiver]]

### Relationships

- related: [[raised-cosine-nyquist-filtering|Raised-Cosine Filter]]
- causes: [[error-sources-and-error-correction-in-communication|Error Detection and Correction]]
