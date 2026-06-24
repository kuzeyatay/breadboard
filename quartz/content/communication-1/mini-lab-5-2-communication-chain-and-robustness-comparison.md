---
title: "Mini-lab 5.2 communication chain and robustness comparison"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 63", "Page 64", "Page 65"]
related: ["bits-per-sample-versus-bits-per-level", "digital-robustness-versus-analog-under-noisy-transmission"]
tags: ["pcm", "sampling", "quantization", "line-coding", "noise-spectral-density", "analog-transmitter", "digital-receiver", "lab-2", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-063-2.png", "/communication-1/assets/communications-1-coursereader-page-064-2.png"]
---

## Mini-lab 5.2 communication chain and robustness comparison

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 63, Page 64, Page 65

The mini-lab presents the entire analog and digital communication chain in one MATLAB environment so students can compare how each system behaves under the same noisy channel. The digital branch includes sampling, quantization, PCM signaling, physical transmission, channel noise, digital reception, PCM decoding, and digital-to-analog reconstruction. The analog branch sends the recorded audio directly through physical transmission and the same channel to an analog receiver. The exercise is designed to show that digital transmission can be more robust than analog transmission, while also revealing a tradeoff: increasing the number of bits per sample improves quantization quality but increases the amount of transmitted digital data, which can worsen receiver output quality under fixed transmission conditions. The mini-lab lets users change the sampling settings, line coding, transmitter power, and channel noise spectral density, then compare output audio and receiver signal-to-noise measures such as $SNR_{in}$ and $SNR_{out}$. The educational aim is not only to observe decoded waveforms and listen to audio, but also to connect audible quality to quantization noise, channel noise, and the digital link budget.

### Source snapshots

![Communications_1_CourseReader Page 63](/communication-1/assets/communications-1-coursereader-page-063-2.png)

![Communications_1_CourseReader Page 64](/communication-1/assets/communications-1-coursereader-page-064-2.png)

### Page-grounded details

#### Page 63

Minilab exercise 5.2 - Digital communications under noise
This mini-lab exercise requires you to use Mini-lab 3 (the communication system)
on MATLAB.
When you open Minilab 3 you will be confronted with the following view:
It may at first seem similar to Minilab 2 however, you may see that there are more
tabs than in Minilab 2, this is because in this minilab we consider the whole com-
munication chain. We will first spend some time to understand how the minilab
works.
The figure below shows the communication chain, and what each tab in the minilab
represents in the chain. It additionally includes an analog transmitter and analog
receiver, which both get transmitted through the same channel. The reason for
including basic analog transmitters is that you can understand why digital commu-
nications are more robust in comparison to analog communications.
59

#### Page 64

Hello world
Digital transmitter
Sampling
(Analog-to-digital
conversion)
Quantization
(Digitization) 	PCM Signaling
(Line coding)
Physical transmission
	(ex. antenna or fiber optic)
101
010
110
001
010 	101011010
1 0 1 0 1 1 0 1 0
PHYSICAL CHANNEL
(wired or wireless)
Raised-cosine filter	ISI
+
Noise
Signal
Noisy
signal
Analog transmitter
Physical transmission
	(ex. antenna or fiber optic)
Digital receiver
Physical receiver
RECEIVER
PCM Decoding 	Signal reconstruction
	(Digital-to-analog)
Message
V_t 	1
0
001011011 	101011010
DAC101011010
LPF
Analog receiver
RECEIVER
Hello world
In the 'Sampling and Quantization' tab, you may change the settings, such as
sampling frequency and the number of bits per sample, and it's also the place
where you record the audio that you want to transmit. We highly advise keeping the
recording duration to only 1 second, because when performing digital transmission
and receiving, including a higher recording duration will lead to more data being
processed, which might make the minilab run slower.
In the 'Digital transmitter' tab, you may choose the line coding (see Fig. 58 for all
the line codings), and also the transmitter power in watts. You will also se

[Truncated for analysis]

#### Page 65

- 2) Once you have recorded, open the 'Digital transmitter' tab. In this tab,
change the line coding to 'Polar RZ' and set the transmitter power to 10
Watt. Then go to the 'Channel' tab and set the noise spectral density to
3e - 07. Then go again back to the 'Digital transmitter' tab and click the
transmit button.
- 3) After you do this click on the button 'Transmit data' to transmit the data.
You will have to wait about 20 seconds (depending on your computer) until
the waveform shows up.
- 4) After the waveform shows up, go to the 'Digital receiver' tab, and play the
audio. Take a note of the SN Rout. What do you hear? Is the audio quality
poor? If so, from where does this noise come from? (hint: Its not because of
channel noise)
- 5) Now, go back to the 'Sampling and Quantization' tab, and change the
number of bits per sample to 16. Then, move to the 'Digital transmitter' tab
and click the transmit button. After the new waveform shows up, go to the
'Digital receiver' tab and play the sound. Take note on the SN Rout. Do you
hear a better-quality audio? Did the SN Rout value improve? Can you explain
why increasing bits per sample increases audio quality (hence SN Rout)?
- 6) Now re

[Truncated for analysis]

### Key points

- The mini-lab models the whole communication chain rather than an isolated subsystem.
- Digital and analog transmitters send through the same physical channel for comparison.
- The sampling and quantization tab controls sampling frequency, bits per sample, and recording.
- The digital transmitter tab lets users choose line coding and transmitter power.
- The channel tab sets the noise spectral density $N_0/2$.
- The digital receiver tab shows decoded signal behavior and reports $SNR_{in}$ and $SNR_{out}$.
- The exercise is intended to show digital robustness relative to analog.
- The exercise also shows that increasing bits per sample does not necessarily improve final $SNR_{out}$.

### Related topics

- [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]
- [[digital-robustness-versus-analog-under-noisy-transmission|Digital robustness versus analog under noisy transmission]]

### Relationships

- applies-to: [[digital-robustness-versus-analog-under-noisy-transmission|Digital robustness versus analog under noisy transmission]]
- depends-on: [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]

## Added from [[topicmap|Communications 1 (5ETC0) Topic Map]]

Source label: Topic map for the full course

Locations: Page 1

The topic map presents a full communication system as a sequence of transformations that carry a message from a transmitter to a receiver through a physical channel. The transmitter begins with a message, converts it into a digital representation through sampling and quantization, formats the bits through PCM signaling or line coding, optionally modulates the signal, and physically transmits it through a medium such as an antenna or fiber optic link. The physical channel may be wired or wireless and can distort the transmitted signal through ISI and noise. The receiver reverses the process: it physically receives the signal, decodes the PCM bitstream, detects and corrects errors, reconstructs an analog signal using digital-to-analog conversion, and recovers the original message such as "Hello world." The diagram emphasizes that communication is not a single operation but a chain of encoding, transmission, impairment, decoding, and reconstruction stages.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### New key points

- The communication chain starts with a message at the transmitter.
- Sampling performs analog-to-digital conversion before digitization.
- Quantization performs digitization of sampled values.
- PCM signaling or line coding maps digitized data into a transmissible bit sequence.
- Modulation is shown as an optional step before physical transmission.
- The physical channel carries the signal through wired or wireless media.
- The receiver performs physical reception, PCM decoding, error detection and correction, and signal reconstruction.
- The recovered message is shown as "Hello world."
