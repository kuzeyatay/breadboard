---
title: "Learning Map"
date: "2026-07-05T10:06:47.442Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mr7mkkjb_pfgiv3e"
learningVersionId: "learning_mr7mkkjb_pfgiv3e"
sourceSetHash: "8e71f44a59b63035e1361ca94770a071a583a8b63992e5135fb6b5aaf69e1614"
---

# Learning Map

## Section Order

- 1. Why This Topic Exists and the Mechanism Works
  - 1.1 [[learning/1. Why This Topic Exists and the Mechanism Works/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
  - 1.2 [[learning/1. Why This Topic Exists and the Mechanism Works/1.2 Asynchronous Brain-Inspired Computation|Asynchronous Brain-Inspired Computation]]
  - 1.3 [[learning/1. Why This Topic Exists and the Mechanism Works/1.3 Sparse Events and Energy Efficiency|Sparse Events and Energy Efficiency]]
  - 1.4 [[learning/1. Why This Topic Exists and the Mechanism Works/1.4 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 1.5 [[learning/1. Why This Topic Exists and the Mechanism Works/1.5 Encoding, Excitation, and Lateral Inhibition|Encoding, Excitation, and Lateral Inhibition]]
- 2. The Formal Description
  - 2.1 [[learning/2. The Formal Description/2.1 Accuracy and Latency|Accuracy and Latency]]
  - 2.2 [[learning/2. The Formal Description/2.2 Spike Count and Energy|Spike Count and Energy]]
  - 2.3 [[learning/2. The Formal Description/2.3 Energy Efficiency and Convergence Time|Energy Efficiency and Convergence Time]]
- 3. How It Learns or Changes and it Is Measured
  - 3.1 [[learning/3. How It Learns or Changes and it Is Measured/3.1 Three Ways SNNs Learn|Three Ways SNNs Learn]]
  - 3.2 [[learning/3. How It Learns or Changes and it Is Measured/3.2 Unified Evaluation Across Metrics|Unified Evaluation Across Metrics]]
- 4. What the Results Show
  - 4.1 [[learning/4. What the Results Show/4.1 Dense Activations and Spike Events|Dense Activations and Spike Events]]
  - 4.2 [[learning/4. What the Results Show/4.2 Accuracy and Energy Tradeoffs|Accuracy and Energy Tradeoffs]]
  - 4.3 [[learning/4. What the Results Show/4.3 Latency Tradeoffs Across SNN Methods|Latency Tradeoffs Across SNN Methods]]
  - 4.4 [[learning/4. What the Results Show/4.4 Spike Count as an Energy Clue|Spike Count as an Energy Clue]]
  - 4.5 [[learning/4. What the Results Show/4.5 Convergence and Learning Curves|Convergence and Learning Curves]]
- 5. When to Use It, and Its Limits
  - 5.1 [[learning/5. When to Use It, and Its Limits/5.1 Limits of Conventional Neural Architectures|Limits of Conventional Neural Architectures]]
  - 5.2 [[learning/5. When to Use It, and Its Limits/5.2 Neuromorphic Hardware for Low-Power Spiking|Neuromorphic Hardware for Low-Power Spiking]]
  - 5.3 [[learning/5. When to Use It, and Its Limits/5.3 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
  - 5.4 [[learning/5. When to Use It, and Its Limits/5.4 Applications for Event-Driven Intelligence|Applications for Event-Driven Intelligence]]
  - 5.5 [[learning/5. When to Use It, and Its Limits/5.5 Open Challenges for SNN Adoption|Open Challenges for SNN Adoption]]

## Prerequisite Chain

- Start here -> Why This Topic Exists and the Mechanism Works
- Why This Topic Exists and the Mechanism Works -> The Formal Description
- The Formal Description -> How It Learns or Changes and it Is Measured
- How It Learns or Changes and it Is Measured -> What the Results Show
- What the Results Show -> When to Use It, and Its Limits

## Trunk, Branch, Leaf Concepts

- Trunk: Why This Topic Exists and the Mechanism Works
  - Branch/leaf: Why Spiking Neural Networks Exist
  - Branch/leaf: Asynchronous Brain-Inspired Computation
  - Branch/leaf: Sparse Events and Energy Efficiency
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: Encoding, Excitation, and Lateral Inhibition
- Trunk: The Formal Description
  - Branch/leaf: Accuracy and Latency
  - Branch/leaf: Spike Count and Energy
  - Branch/leaf: Energy Efficiency and Convergence Time
- Trunk: How It Learns or Changes and it Is Measured
  - Branch/leaf: Three Ways SNNs Learn
  - Branch/leaf: Unified Evaluation Across Metrics
- Trunk: What the Results Show
  - Branch/leaf: Dense Activations and Spike Events
  - Branch/leaf: Accuracy and Energy Tradeoffs
  - Branch/leaf: Latency Tradeoffs Across SNN Methods
  - Branch/leaf: Spike Count as an Energy Clue
  - Branch/leaf: Convergence and Learning Curves
- Trunk: When to Use It, and Its Limits
  - Branch/leaf: Limits of Conventional Neural Architectures
  - Branch/leaf: Neuromorphic Hardware for Low-Power Spiking
  - Branch/leaf: Choosing an SNN Training Strategy
  - Branch/leaf: Applications for Event-Driven Intelligence
  - Branch/leaf: Open Challenges for SNN Adoption

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- The provided source map includes extracted captions for formulas but not exact mathematical notation, so formula teaching should use caption-level definitions unless the full source text is later available.
- Exact benchmark values from result tables and graphs should not be invented; only use reported statements such as surrogate-gradient SNNs approaching ANN accuracy within 1–2%, latency as low as 10 ms, convergence by about the 20th epoch, converted SNNs needing higher spike counts and longer simulation windows, and STDP energy as low as 5 mJ per inference.
- Detailed LIF differential equations, biological neuron anatomy, implementation code, dataset preprocessing, and broad neuromorphic hardware surveys are outside the current source-supported scope.
- Several source visuals are reused in synthesis units only as evidence for decision-making; primary interpretation should occur in their earlier dedicated units to avoid duplicate visual dumps.
