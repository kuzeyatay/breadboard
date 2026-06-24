---
title: "Physical Channel"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["transmission-media-symbols-and-detection", "physical-receiver", "isi-and-noise", "error-sources-and-error-correction-in-communication"]
tags: ["physical-channel", "wired", "wireless", "isi", "noise", "noisy-signal"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## Physical Channel

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

The physical channel is the central medium between transmitter and receiver. In the topic map it is explicitly labeled "PHYSICAL CHANNEL" and is shown as carrying a message through a wired or wireless path. The channel receives the physically transmitted signal and delivers a potentially altered signal to the physical receiver. The diagram emphasizes that the channel is not ideal: it can introduce intersymbol interference and noise, converting a clean "Signal" into a "Noisy signal." The physical channel therefore explains why receiver-side operations such as PCM decoding and error detection are necessary. It is the boundary where engineered transmitter signals encounter real-world transmission impairments.

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

- The physical channel sits between transmitter and receiver.
- It can be wired or wireless.
- It carries the message after physical transmission.
- It is affected by ISI and noise.
- The output of the channel may be a noisy signal.
- Receiver-side processing compensates for channel effects.

### Related topics

- [[transmission-media-symbols-and-detection|Physical Transmission Media]]
- [[physical-receiver|Physical Receiver]]
- [[isi-and-noise|ISI and Noise]]
- [[error-sources-and-error-correction-in-communication|Error Detection and Correction]]

### Relationships

- enables: [[physical-receiver|Physical Receiver]]
- causes: [[isi-and-noise|ISI and Noise]]
