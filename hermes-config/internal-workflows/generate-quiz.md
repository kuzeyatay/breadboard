# Generate a quiz

Internal first-party workflow. This is an agent-profile instruction, not a
public skills.sh catalog entry or an installable slash command.

Procedure for producing a grounded self-test.

1. Retrieve the target page/section with `garden_get_page` /
   `garden_get_page_context` and identify the key claims, definitions, formulas,
   and relationships it contains.
2. Write questions that test understanding of THAT content — a mix of recall,
   application, and "trace the reasoning" questions. Every question's answer must
   be verifiable from the retrieved content.
3. Provide an answer key with a citation (page/source anchor) for each answer.
4. Do not write questions whose answers require knowledge the garden does not
   contain. Calibrate difficulty to the material's level.
