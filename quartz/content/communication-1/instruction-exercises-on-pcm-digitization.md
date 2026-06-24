---
title: "Instruction exercises on PCM digitization"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 66", "Page 67"]
related: ["mini-lab-5-2-communication-chain-and-robustness-comparison", "bits-per-sample-versus-bits-per-level", "baud-rate-and-bit-rate-relationships"]
tags: ["pcm", "quantizer", "bits-per-sample", "ber", "video-signal", "music-signal", "sinc-pulses", "week-2", "week-5"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-066-2.png", "/communication-1/assets/communications-1-coursereader-page-067-2.png"]
---

## Instruction exercises on PCM digitization

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 66, Page 67

The digitization exercise set develops quantitative PCM design under practical constraints. The problems ask students to determine the number of quantization bits required for a target output signal-to-noise ratio, to compute the minimum bandwidth needed for transmitting digitized video, and to analyze the relation among channel bandwidth, BER, and recovered output quality. Several exercises emphasize that the output quality of a PCM system depends both on quantization resolution and on the reliability of the digital transmission through noise. They also show that increasing signal power or altering the number of bits per sample changes the balance between quantization noise and channel-induced errors. The exercises span audio and video examples with explicit sampling frequencies, quantizer levels, and white Gaussian noise assumptions, making them reusable as standard design templates for PCM system analysis. The durable concepts are the use of $M = 2^n$ levels, the distinction between analog input SNR and output SNR after PCM recovery, and the need to jointly optimize bit depth and transmission bandwidth.

### Source snapshots

![Communications_1_CourseReader Page 66](/communication-1/assets/communications-1-coursereader-page-066-2.png)

![Communications_1_CourseReader Page 67](/communication-1/assets/communications-1-coursereader-page-067-2.png)

### Page-grounded details

#### Page 66

5.6 Instruction Exercises - Digitization
The solutions to these exercises may be found under the page 5ETC0 Canvas Page Mod-
ules -> Week 2 -> Pulse Code Modulation (PCM) digitalization
Problem 4 (Video solution available)
For a PCM system is required that the signal to noise ratio at the output of the receiver is
34 dB in case of a uniformly distributed input signal of the quantizer. The number of levels
of the quantizer is M = 2n where n is the number of bits per sample.
a)What is the minimum value of n to meet the system requirement?
b)What signal to noise ratio can be tolerated at the input of the receiver in that
case?
Problem 5 (Video solution available)
A video signal with a bandwidth of 5 MHz is transmitted over a baseband channel having
the same bandwidth, with white Gaussian noise added to the video signal. The signal-to-
noise ratio of the received analog signal is 20 dB.
To improve the transmission quality the video signal is digitized to a PCM signal; it is
sampled, quantized and coded in 400 levels. For the transfer, only the bandwidth of the
channel is increased. The transmit power remains the same.
a)What is the minimum bandwidth required for transmission of the PCM

[Truncated for analysis]

#### Page 67

Problem 7 (Video solution available)
An analog video signal with a maximum frequency of 2 MHz is sent over a transmission line
connection. The transmit power is 1 Watt. The transmission loss on the connection is 21
dB. The two sided spectral density of the received noise is No
2 = 2 x 10-11 Watt/Hz. The
receiver is noise-free, and the receive filter is an ideal low-pass filter.
a)What is the signal-to-noise ratio at the input of the receiver?
The connection is now digitized, and the video signal is transmitted by means of a (binary)
PCM system. The quantization is uniform, the number of bits per sample is 5 and the trans-
mission system is using ideal sinc pulses for transmission. The transmission power remains
the same (1 Watt), but the bandwidth of the receive filter is adapted, of course.
b)What is the SNR at the input the PCM receiver?
c) What is at the output of the PCM receiver the signal to noise ratio, SNR, of
the recovered video signal?
You will now have the freedom to adjust the number of bits per sample (and the transmission
bandwidth) to achieve optimal transmission.
d)What is the number of bits per sample for a maximum signal-to-noise ratio
at the output of the PCM rec

[Truncated for analysis]

### Key points

- Quantizer levels are related to bits per sample by $M = 2^n$.
- One exercise requires achieving an output SNR of 34 dB for a uniformly distributed quantizer input.
- Another problem digitizes a 5 MHz video signal into 400 quantization levels and asks for required PCM bandwidth.
- A music PCM problem requires output $(S/N)_O = 50$ dB for a spectrum up to 16 kHz.
- A binary PCM video problem fixes 5 bits per sample and ideal sinc pulse transmission.
- The exercises ask for BER, receiver input SNR, and recovered output SNR.

### Related topics

- [[mini-lab-5-2-communication-chain-and-robustness-comparison|Mini-lab 5.2 communication chain and robustness comparison]]
- [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]
- [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]

### Relationships

- depends-on: [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]
- depends-on: [[baud-rate-and-bit-rate-relationships|Baud rate and bit rate relationships]]
