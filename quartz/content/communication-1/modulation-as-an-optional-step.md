---
title: "Modulation as an Optional Step"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["pcm-signaling-and-line-coding", "transmission-media-symbols-and-detection", "physical-channel"]
tags: ["modulation", "pcm-signaling", "line-coding", "physical-transmission"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## Modulation as an Optional Step

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

Modulation is shown in the transmitter chain as an optional step between PCM signaling and physical transmission. This placement indicates that, after the message has been converted into a line-coded digital signal, the system may further transform the signal into a form better suited to the physical medium. The map does not specify a modulation type, carrier, or formula, but it explicitly marks the step as optional, meaning not every communication setup in the course flow requires it. Modulation is therefore distinct from line coding: PCM signaling creates a digital sequence or waveform, while modulation is an additional transformation before the signal enters the physical transmission mechanism. The diagram associates modulation with topic letters J,K, linking it to a later course block.

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

- Modulation is labeled as an "optional step."
- It appears after PCM signaling or line coding.
- It appears before physical transmission.
- The map does not specify a particular modulation method.
- Its optional status distinguishes it from required transmitter stages such as sampling and quantization.
- The stage is associated with topic letters J,K.

### Related topics

- [[pcm-signaling-and-line-coding|PCM Signaling and Line Coding]]
- [[transmission-media-symbols-and-detection|Physical Transmission Media]]
- [[physical-channel|Physical Channel]]

### Relationships

- enables: [[transmission-media-symbols-and-detection|Physical Transmission Media]]
