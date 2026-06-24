---
title: "Q-Function as Gaussian Tail Probability"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 56"]
related: ["probability-density-functions-and-gaussian-models", "additive-white-gaussian-noise-model", "bit-error-probability-on-awgn-channels"]
tags: ["q-function", "gaussian-distribution", "tail-probability", "threshold-detection", "probability-density-function"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-056-2.png"]
---

## Q-Function as Gaussian Tail Probability

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 56

The Q-function is introduced as the tail probability of a Gaussian random variable. Conceptually, it gives the probability that a normally distributed variable exceeds a threshold located $z$ standard deviations away from the mean. It is defined by $$Q(z)=\frac{1}{\sqrt{2\pi}}\int_z^{\infty} e^{-u^2/2}du,$$ with the standardized threshold $$z = \frac{x_0 - \mu}{\sigma}.$$ In the text, this is visualized as the area under the Gaussian PDF to the right of the point $z$. The function becomes essential in communications because decision errors on noisy binary signals correspond to Gaussian tails crossing the wrong decision region. The material also notes a practical engineering aid: the Q-function can be looked up graphically, and a common upper bound of the form $\frac{1}{\sqrt{2\pi}z}e^{-z^2/2}$ is shown. The durable value of this topic is that it turns receiver-threshold problems under Gaussian noise into standard probability evaluations using a single function of normalized distance from the threshold.

### Source snapshots

![Communications_1_CourseReader Page 56](/communication-1/assets/communications-1-coursereader-page-056-2.png)

### Page-grounded details

#### Page 56

5.5.5 Q-function
The Q-function, denoted as Q(z), is defined as the tail probability of the Gaussian distribu-
tion. Intuitively, it means what is the probability that a random variable with a Gaussian
distribution, will take a value larger than z standard deviations. Q-function mathematically
is defined as
Q(z) = 1
√2π
Z ∞
z
e- u2
2 du (79)
where z is defined as
z = x0 - μ
σ (80)
Visually, it means the area of the tail of the Gaussian distribution, which is visualized in
Fig. 39
-5 	-4 	-3 	-2 	-1 	0 	1 	2 	3 	4 	5
X
0
0.05
0.1
0.15
0.2
0.25
0.3
0.35
0.4
Probability Density
Figure 39: Illustration of Q-function
Nevertheless, you may always use Fig. 40 to get the value of the Q-function based on z or
the other way around (getting the value of z based on the Q-function result).
Q (z)
e 	z2
/ 2
1 	2 	3 	4 	5 	6	0
10 	7
10 	8
10 	6
10 	5
10 	4
10 	3
10 	2
10 	1
0.5
1.0
z
1
2p z
Q (z)
Figure 40: Plot of Q-function upper bounded by 1	√2πz e-z2/2. [2, ch. B-7, p.703]
52

### Key points

- The Q-function gives the Gaussian tail probability.
- It measures the probability that a Gaussian random variable exceeds a threshold.
- Its definition is $Q(z)=\frac{1}{\sqrt{2\pi}}\int_z^{\infty} e^{-u^2/2}du$.
- The normalized distance is $z = (x_0-\mu)/\sigma$.
- In receiver problems, decision errors correspond to Gaussian tail areas.
- The text provides a graph for looking up Q-function values.

### Related topics

- [[probability-density-functions-and-gaussian-models|Probability Density Functions and Gaussian Models]]
- [[additive-white-gaussian-noise-model|Additive White Gaussian Noise Model]]
- [[bit-error-probability-on-awgn-channels|Bit Error Probability on AWGN Channels]]

### Relationships

- depends-on: [[bit-error-probability-on-awgn-channels|Bit Error Probability on AWGN Channels]]
