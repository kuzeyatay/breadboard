---
title: "Physical Receiver"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["transmission-media-symbols-and-detection", "physical-channel", "pcm-decoding", "isi-and-noise"]
tags: ["physical-receiver", "antenna", "fiber-optic", "physical-channel", "pcm-decoding"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## Physical Receiver

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

The physical receiver is the first receiver-side block after the physical channel. It is described with the same examples as physical transmission: antenna or fiber optic. This pairing indicates that the receiving apparatus must match the transmission medium, whether wireless via antenna or wired/optical via fiber optic. The physical receiver takes the channel output, which may be noisy due to ISI and noise, and provides it to later digital receiver operations such as PCM decoding and error detection. In the complete communication chain, the physical receiver is the transition point from propagated physical energy back into a processable electrical or digital signal. Its position explains why physical-layer impairments must be handled before or during decoding.

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

- The physical receiver follows the physical channel.
- Examples include antenna and fiber optic receiver structures.
- It is the receiver-side counterpart of physical transmission.
- It receives signals that may be impaired by ISI and noise.
- Its output feeds PCM decoding.
- It belongs to the receiver side of the system.

### Related topics

- [[transmission-media-symbols-and-detection|Physical Transmission Media]]
- [[physical-channel|Physical Channel]]
- [[pcm-decoding|PCM Decoding]]
- [[isi-and-noise|ISI and Noise]]

### Relationships

- enables: [[pcm-decoding|PCM Decoding]]
