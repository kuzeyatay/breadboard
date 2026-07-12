---
title: "Learning Map"
date: "2026-07-12T11:48:03.495Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrhqb6op_fspr5tk"
learningVersionId: "learning_mrhqb6op_fspr5tk"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Learning Map

## Section Order

- 1. How Brain-inspired Computation Works
  - 1.1 [[learning/1. How Brain-inspired Computation Works/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
  - 1.2 [[learning/1. How Brain-inspired Computation Works/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]]
  - 1.3 [[learning/1. How Brain-inspired Computation Works/1.3 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 1.4 [[learning/1. How Brain-inspired Computation Works/1.4 From Encoded Input to Spike Trains|From Encoded Input to Spike Trains]]
  - 1.5 [[learning/1. How Brain-inspired Computation Works/1.5 Winner-Take-All Competition|Winner-Take-All Competition]]
- 2. How Non-differentiable Spike Event Is Applied
  - 2.1 [[learning/2. How Non-differentiable Spike Event Is Applied/2.1 How SNNs Learn|How SNNs Learn]]
  - 2.2 [[learning/2. How Non-differentiable Spike Event Is Applied/2.2 Surrogate-Gradient Training|Surrogate-Gradient Training]]
  - 2.3 [[learning/2. How Non-differentiable Spike Event Is Applied/2.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
  - 2.4 [[learning/2. How Non-differentiable Spike Event Is Applied/2.4 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]]
- 3. How Performance Is Evaluated
  - 3.1 [[learning/3. How Performance Is Evaluated/3.1 Classification Accuracy|Classification Accuracy]]
  - 3.2 [[learning/3. How Performance Is Evaluated/3.2 Inference Latency|Inference Latency]]
  - 3.3 [[learning/3. How Performance Is Evaluated/3.3 Spike Count and Event Activity|Spike Count and Event Activity]]
- 4. Measuring Energy Cost Per Spike
  - 4.1 [[learning/4. Measuring Energy Cost Per Spike/4.1 Energy per Inference|Energy per Inference]]
  - 4.2 [[learning/4. Measuring Energy Cost Per Spike/4.2 Normalized Energy Efficiency|Normalized Energy Efficiency]]
  - 4.3 [[learning/4. Measuring Energy Cost Per Spike/4.3 Convergence Time and Learning Curves|Convergence Time and Learning Curves]]
- 5. Comparing and Interpreting the Results
  - 5.1 [[learning/5. Comparing and Interpreting the Results/5.1 Accuracy and Energy Tradeoffs|Accuracy and Energy Tradeoffs]]
  - 5.2 [[learning/5. Comparing and Interpreting the Results/5.2 Latency, Energy, and Spike-Count Tradeoffs|Latency, Energy, and Spike-Count Tradeoffs]]
  - 5.3 [[learning/5. Comparing and Interpreting the Results/5.3 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]

## Prerequisite Chain

- Start here -> How Brain-inspired Computation Works
- How Brain-inspired Computation Works -> How Non-differentiable Spike Event Is Applied
- How Non-differentiable Spike Event Is Applied -> How Performance Is Evaluated
- How Performance Is Evaluated -> Measuring Energy Cost Per Spike
- Measuring Energy Cost Per Spike -> Comparing and Interpreting the Results

## Trunk, Branch, Leaf Concepts

- Trunk: How Brain-inspired Computation Works
  - Branch/leaf: Why Spiking Neural Networks Exist
  - Branch/leaf: Spikes, Timing, and Event-Driven Computation
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: From Encoded Input to Spike Trains
  - Branch/leaf: Winner-Take-All Competition
- Trunk: How Non-differentiable Spike Event Is Applied
  - Branch/leaf: How SNNs Learn
  - Branch/leaf: Surrogate-Gradient Training
  - Branch/leaf: ANN-to-SNN Conversion
  - Branch/leaf: Spike-Timing-Dependent Plasticity
- Trunk: How Performance Is Evaluated
  - Branch/leaf: Classification Accuracy
  - Branch/leaf: Inference Latency
  - Branch/leaf: Spike Count and Event Activity
- Trunk: Measuring Energy Cost Per Spike
  - Branch/leaf: Energy per Inference
  - Branch/leaf: Normalized Energy Efficiency
  - Branch/leaf: Convergence Time and Learning Curves
- Trunk: Comparing and Interpreting the Results
  - Branch/leaf: Accuracy and Energy Tradeoffs
  - Branch/leaf: Latency, Energy, and Spike-Count Tradeoffs
  - Branch/leaf: Choosing an SNN Training Strategy

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- The available source map is compacted, so exact numerical values must be recovered from the cited artifacts before prose generation rather than inferred from captions or summaries.
- Reported MNIST and CIFAR-10 comparisons must remain bounded to the study setup and must not be presented as universal evidence that SNNs outperform conventional neural networks.
- The source supports conceptual treatments of surrogate gradients, ANN-to-SNN conversion, and STDP, but not detailed surrogate estimators, conversion algorithms, or STDP update equations.
- Energy values must be described according to the source's stated estimation method; they must not be generalized into unsupported hardware-level measurements.
- TrueNorth and Loihi may be discussed only as source-named neuromorphic examples; unsupported architecture details, specifications, and deployment procedures are excluded.
- S1.P10.G1 and S1.P10.T1 represent the same training-loss experiment and should be interpreted together rather than counted as independent evidence.
- S1.P7.T1 with S1.P7.G1, S1.P8.T1 with S1.P8.G1, and S1.P9.T1 with S1.P9.G1 must likewise be paired so exact values and visual trends reinforce one another without duplicating instruction.
- All extracted figures, graphs, tables, and displayed formulas are assigned to inline teaching units; no artifact is reserved for a disconnected visual or evidence dump.
