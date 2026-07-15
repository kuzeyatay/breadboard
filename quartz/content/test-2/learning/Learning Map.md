---
title: "Learning Map"
date: "2026-07-14T16:54:26.389Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrkw4tiu_gzdi57n"
learningVersionId: "learning_mrkw4tiu_gzdi57n"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Learning Map

## Section Order

- 1. Why Spiking Neural Networks Matters
  - 1.1 [[learning/1. Why Spiking Neural Networks Matters/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
- 2. From Discrete Spike Events to Sparse Activity
  - 2.1 [[learning/2. From Discrete Spike Events to Sparse Activity/2.1 Spikes, Sparsity, and Event-Driven Computation|Spikes, Sparsity, and Event-Driven Computation]]
  - 2.2 [[learning/2. From Discrete Spike Events to Sparse Activity/2.2 Spike Timing and Temporal Information|Spike Timing and Temporal Information]]
  - 2.3 [[learning/2. From Discrete Spike Events to Sparse Activity/2.3 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 2.4 [[learning/2. From Discrete Spike Events to Sparse Activity/2.4 Encoding Inputs as Spike Trains|Encoding Inputs as Spike Trains]]
  - 2.5 [[learning/2. From Discrete Spike Events to Sparse Activity/2.5 Excitatory Processing and Winner-Take-All Competition|Excitatory Processing and Winner-Take-All Competition]]
- 3. How Differentiable Approximation Is Applied
  - 3.1 [[learning/3. How Differentiable Approximation Is Applied/3.1 Surrogate-Gradient Training|Surrogate-Gradient Training]]
  - 3.2 [[learning/3. How Differentiable Approximation Is Applied/3.2 Converting an ANN into an SNN|Converting an ANN into an SNN]]
  - 3.3 [[learning/3. How Differentiable Approximation Is Applied/3.3 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]]
- 4. Measuring Correct-prediction Ratio
  - 4.1 [[learning/4. Measuring Correct-prediction Ratio/4.1 Classification Accuracy|Classification Accuracy]]
  - 4.2 [[learning/4. Measuring Correct-prediction Ratio/4.2 Inference Latency|Inference Latency]]
  - 4.3 [[learning/4. Measuring Correct-prediction Ratio/4.3 Spike Count and Estimated Energy Consumption|Spike Count and Estimated Energy Consumption]]
  - 4.4 [[learning/4. Measuring Correct-prediction Ratio/4.4 Energy Efficiency and Convergence Time|Energy Efficiency and Convergence Time]]
- 5. Comparing and Interpreting the Results
  - 5.1 [[learning/5. Comparing and Interpreting the Results/5.1 Three Strategies for Training Spiking Neural Networks|Three Strategies for Training Spiking Neural Networks]]
  - 5.2 [[learning/5. Comparing and Interpreting the Results/5.2 Accuracy and Energy Across Neural Models|Accuracy and Energy Across Neural Models]]
  - 5.3 [[learning/5. Comparing and Interpreting the Results/5.3 Latency Across ANN and SNN Approaches|Latency Across ANN and SNN Approaches]]
- 6. What the Results Show
  - 6.1 [[learning/6. What the Results Show/6.1 Energy Use and Spike Activity Across Models|Energy Use and Spike Activity Across Models]]
  - 6.2 [[learning/6. What the Results Show/6.2 Training Loss and Convergence Behavior|Training Loss and Convergence Behavior]]
  - 6.3 [[learning/6. What the Results Show/6.3 Learning Curves and Reported Training Outcomes|Learning Curves and Reported Training Outcomes]]
- 7. Using Constraint-driven Model Selection in Practice
  - 7.1 [[learning/7. Using Constraint-driven Model Selection in Practice/7.1 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
  - 7.2 [[learning/7. Using Constraint-driven Model Selection in Practice/7.2 SNN Applications and Neuromorphic Deployment|SNN Applications and Neuromorphic Deployment]]
  - 7.3 [[learning/7. Using Constraint-driven Model Selection in Practice/7.3 Hardware Standardization and Scalable Training|Hardware Standardization and Scalable Training]]

## Prerequisite Chain

- Start here -> Why Spiking Neural Networks Matters
- Why Spiking Neural Networks Matters -> From Discrete Spike Events to Sparse Activity
- From Discrete Spike Events to Sparse Activity -> How Differentiable Approximation Is Applied
- How Differentiable Approximation Is Applied -> Measuring Correct-prediction Ratio
- Measuring Correct-prediction Ratio -> Comparing and Interpreting the Results
- Comparing and Interpreting the Results -> What the Results Show
- What the Results Show -> Using Constraint-driven Model Selection in Practice

## Trunk, Branch, Leaf Concepts

- Trunk: Why Spiking Neural Networks Matters
  - Branch/leaf: Why Spiking Neural Networks Exist
- Trunk: From Discrete Spike Events to Sparse Activity
  - Branch/leaf: Spikes, Sparsity, and Event-Driven Computation
  - Branch/leaf: Spike Timing and Temporal Information
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: Encoding Inputs as Spike Trains
  - Branch/leaf: Excitatory Processing and Winner-Take-All Competition
- Trunk: How Differentiable Approximation Is Applied
  - Branch/leaf: Surrogate-Gradient Training
  - Branch/leaf: Converting an ANN into an SNN
  - Branch/leaf: Spike-Timing-Dependent Plasticity
- Trunk: Measuring Correct-prediction Ratio
  - Branch/leaf: Classification Accuracy
  - Branch/leaf: Inference Latency
  - Branch/leaf: Spike Count and Estimated Energy Consumption
  - Branch/leaf: Energy Efficiency and Convergence Time
- Trunk: Comparing and Interpreting the Results
  - Branch/leaf: Three Strategies for Training Spiking Neural Networks
  - Branch/leaf: Accuracy and Energy Across Neural Models
  - Branch/leaf: Latency Across ANN and SNN Approaches
- Trunk: What the Results Show
  - Branch/leaf: Energy Use and Spike Activity Across Models
  - Branch/leaf: Training Loss and Convergence Behavior
  - Branch/leaf: Learning Curves and Reported Training Outcomes
- Trunk: Using Constraint-driven Model Selection in Practice
  - Branch/leaf: Choosing an SNN Training Strategy
  - Branch/leaf: SNN Applications and Neuromorphic Deployment
  - Branch/leaf: Hardware Standardization and Scalable Training

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- The supplied source map is compacted, so learner-facing prose should verify exact numerical values and labels against the full extracted source before publication.
- Reported accuracy, latency, energy, spike-count, loss, and convergence outcomes must remain tied to the evaluated setup and must not be presented as general guarantees.
- Energy consumption is defined by the source's operation-cost estimate and should not be described as direct physical hardware measurement unless the full source explicitly establishes that equivalence.
- TrueNorth and Loihi should be used only as source-cited low-power neuromorphic hardware examples; unsupported architectural or benchmark details remain outside scope.
- The interactive STDP visual must remain conceptual and source-bounded because the supplied material does not support a specific STDP update equation.
- All seventeen extracted visual artifacts are assigned inline: two conceptual figures, six displayed formulas, four result tables, and five result graphs.
