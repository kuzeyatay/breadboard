---
title: "Learning Map"
date: "2026-07-10T17:25:36.981Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrf7hkcc_k8tsdta"
learningVersionId: "learning_mrf7hkcc_k8tsdta"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Learning Map

## Section Order

- 1. Why SNNs Need Events
  - 1.1 [[learning/1. Why SNNs Need Events/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
  - 1.2 [[learning/1. Why SNNs Need Events/1.2 Temporal Data and Event-Driven Computation|Temporal Data and Event-Driven Computation]]
  - 1.3 [[learning/1. Why SNNs Need Events/1.3 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 1.4 [[learning/1. Why SNNs Need Events/1.4 Input Encoding and SNN Layers|Input Encoding and SNN Layers]]
- 2. Measuring Accuracy, Latency, and Spike Count
  - 2.1 [[learning/2. Measuring Accuracy, Latency, and Spike Count/2.1 Accuracy|Accuracy]]
  - 2.2 [[learning/2. Measuring Accuracy, Latency, and Spike Count/2.2 Latency|Latency]]
  - 2.3 [[learning/2. Measuring Accuracy, Latency, and Spike Count/2.3 Spike Count|Spike Count]]
- 3. Measuring Energy, Efficiency, and Convergence
  - 3.1 [[learning/3. Measuring Energy, Efficiency, and Convergence/3.1 Energy Consumption|Energy Consumption]]
  - 3.2 [[learning/3. Measuring Energy, Efficiency, and Convergence/3.2 Normalized Energy Efficiency|Normalized Energy Efficiency]]
  - 3.3 [[learning/3. Measuring Energy, Efficiency, and Convergence/3.3 Convergence Time|Convergence Time]]
- 4. How SNNs Learn
  - 4.1 [[learning/4. How SNNs Learn/4.1 How SNNs Learn|How SNNs Learn]]
  - 4.2 [[learning/4. How SNNs Learn/4.2 Surrogate Gradient Training|Surrogate Gradient Training]]
  - 4.3 [[learning/4. How SNNs Learn/4.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
  - 4.4 [[learning/4. How SNNs Learn/4.4 Spike-Timing Dependent Plasticity|Spike-Timing Dependent Plasticity]]
- 5. Metrics and Results Compared
  - 5.1 [[learning/5. Metrics and Results Compared/5.1 Why One Metric Is Not Enough|Why One Metric Is Not Enough]]
  - 5.2 [[learning/5. Metrics and Results Compared/5.2 Continuous Activations and Discrete Spikes|Continuous Activations and Discrete Spikes]]
  - 5.3 [[learning/5. Metrics and Results Compared/5.3 Accuracy, Latency, Energy, and Spike Tradeoffs|Accuracy, Latency, Energy, and Spike Tradeoffs]]
- 6. Where SNNs Fit and What Still Blocks Adoption
  - 6.1 [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.1 Limitations of Conventional Neural Models|Limitations of Conventional Neural Models]]
  - 6.2 [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.2 Neuromorphic Hardware|Neuromorphic Hardware]]
  - 6.3 [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.3 Where SNNs Are Useful|Where SNNs Are Useful]]
  - 6.4 [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.4 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
  - 6.5 [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.5 Persistent Challenges for SNNs|Persistent Challenges for SNNs]]

## Prerequisite Chain

- Start here -> Why SNNs Need Events
- Why SNNs Need Events -> Measuring Accuracy, Latency, and Spike Count
- Measuring Accuracy, Latency, and Spike Count -> Measuring Energy, Efficiency, and Convergence
- Measuring Energy, Efficiency, and Convergence -> How SNNs Learn
- How SNNs Learn -> Metrics and Results Compared
- Metrics and Results Compared -> Where SNNs Fit and What Still Blocks Adoption

## Trunk, Branch, Leaf Concepts

- Trunk: Why SNNs Need Events
  - Branch/leaf: Why Spiking Neural Networks Exist
  - Branch/leaf: Temporal Data and Event-Driven Computation
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: Input Encoding and SNN Layers
- Trunk: Measuring Accuracy, Latency, and Spike Count
  - Branch/leaf: Accuracy
  - Branch/leaf: Latency
  - Branch/leaf: Spike Count
- Trunk: Measuring Energy, Efficiency, and Convergence
  - Branch/leaf: Energy Consumption
  - Branch/leaf: Normalized Energy Efficiency
  - Branch/leaf: Convergence Time
- Trunk: How SNNs Learn
  - Branch/leaf: How SNNs Learn
  - Branch/leaf: Surrogate Gradient Training
  - Branch/leaf: ANN-to-SNN Conversion
  - Branch/leaf: Spike-Timing Dependent Plasticity
- Trunk: Metrics and Results Compared
  - Branch/leaf: Why One Metric Is Not Enough
  - Branch/leaf: Continuous Activations and Discrete Spikes
  - Branch/leaf: Accuracy, Latency, Energy, and Spike Tradeoffs
- Trunk: Where SNNs Fit and What Still Blocks Adoption
  - Branch/leaf: Limitations of Conventional Neural Models
  - Branch/leaf: Neuromorphic Hardware
  - Branch/leaf: Where SNNs Are Useful
  - Branch/leaf: Choosing an SNN Training Strategy
  - Branch/leaf: Persistent Challenges for SNNs

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- Numeric claims should be limited to values explicitly available in the source map, such as surrogate-gradient SNNs within 1-2% of ANN accuracy, convergence by about the 20th epoch, latency as low as 10 milliseconds, and STDP energy as low as 5 millijoules per inference.
- All source-central visuals are assigned to precise units; later page generation should embed or discuss them inline near the concept they support rather than collecting them into a separate figure section.
- Interactive visuals are planned only where the allowed visual types match the concept and where manipulation adds learning value beyond the static source artifact.
