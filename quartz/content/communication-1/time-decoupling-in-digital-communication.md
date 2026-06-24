---
title: "Time Decoupling in Digital Communication"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 6", "Page 7"]
related: ["digital-communication-as-analog-to-digital-to-analog-transfer", "digital-robustness-versus-analog-under-noisy-transmission", "communication-system-block-flow"]
tags: ["sampling", "quantization", "bits", "bit-rate", "time-division-multiplexing", "mobile-networks"]
source_images: ["/communication-1/assets/997203-english-page-006.png", "/communication-1/assets/997203-english-page-007.png"]
---

## Time Decoupling in Digital Communication

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 6, Page 7

The lecture emphasizes a major consequence of sampling: digital information disconnects the duration of the original time-varying experience from the time required to transmit it. A song lasting three and a half minutes can be sampled and represented as a finite number of bits, such as three megabits or thirty megabits depending on sampling depth and quantization. Those bits can then be transmitted at rates such as one, ten, or one hundred megabits per second, allowing the song to be downloaded much faster than real time. This is impossible for purely analog transmission, where the information unfolds in real time. The same idea supports mobile communication and time division multiplexing. Voice is sampled, quantized, compressed, sent in short time windows, and reconstructed at the other end, so many users can share the same radio channel without occupying it continuously.

### Source snapshots

![997203_English Page 6](/communication-1/assets/997203-english-page-006.png)

![997203_English Page 7](/communication-1/assets/997203-english-page-007.png)

### Page-grounded details

#### Page 6

digital, I mean. Yeah, computers are digital, right? Computers are digital. Okay,
that's a good one. So we have dramatically changed how we live by putting computers
everywhere. So if we send analog information, for example, computer doesn't know
what to do with it, right? So, okay, that's very good. What is the benefit of
digitizing everything? What do we do with digital information most of the time?
Yes. We can store it. We can store it, exactly. It's very good that we can store it
because now your mobile phone, if it's not connected to the internet, can still
play music because you have the MP3 files on your phone, for example. So that's
very, very useful. Other possible benefits of using digital communication? Yes. We
can filter out the noise better. That's very deep, thank you. Indeed, we'll talk
about the benefits of it. And what is fundamental about digital compared to analog?
And I think it's important to realize, yeah, please. Yeah, I like it, yes, I was
going to, thank you. So, digital is just a combination of bits, right? And that's
how we can store it as a file. And when we send it, and we talk about what happens
when we send digital information in this course in detail

[Truncated for analysis]

#### Page 7

later. But now we have a bunch of bits, and I can choose to send these three
megabits which represent the song at a bit rate of one megabit per second, or 10
megabits per second, or 100 megabits per second, because you know when you connect
your laptop to the Wi-Fi network, you can actually see the speed at which it's
connected, and depending on the network you're connected, you have better or worse
connection and better or worse bit rate on your link. So now, for example, you can
read or download, or whatever you call it, a three and a half minute song in a
fraction of a second, for example. And that is fundamental to digital information.
You cannot do it with analog. There's no way to take an analog information and to
download it faster than it actually happened. You cannot do this. And this allows a
lot of the things you now take for granted. For example, you, I think you know
this, but if you don't know it, when you talk on your phone with somebody, yeah,
it's not when you
were young, maybe you had a walkie talkie, I don't know, the experience, you had
this thing that you can press and you can talk to your friends. It's a lot of fun.
That was analog. There was really a radio ch

[Truncated for analysis]

### Key points

- Sampling converts a time-varying experience into a finite sequence of bits.
- The original duration and the transmission duration can become different.
- A three-and-a-half-minute song can be sent faster than real time if the bit rate is high enough.
- Analog information cannot be downloaded faster than it happens in time.
- Phone voice is sampled, quantized, compressed, transmitted, decrypted or decoded, and reconstructed.
- Time division multiplexing lets many users share the same channel because each uses it only part of the time.

### Related topics

- [[digital-communication-as-analog-to-digital-to-analog-transfer|Motivations for Sampling and Digital Communication]]
- [[digital-robustness-versus-analog-under-noisy-transmission|Digital Communication and Noise Robustness]]
- [[communication-system-block-flow|Communication System Course Map]]

### Relationships

- related: [[digital-communication-as-analog-to-digital-to-analog-transfer|Motivations for Sampling and Digital Communication]]
- applies-to: [[communication-system-block-flow|Communication System Course Map]]
