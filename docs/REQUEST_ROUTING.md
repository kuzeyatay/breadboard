# Request routing

The shared Hermes planner uses `dashboard/src/lib/hermes/request-language.ts`
to distinguish requested actions from words mentioned in a message. It is a
conservative deterministic parser, not a general natural-language model.
Ambiguous wording can stay conversational so the runtime can interpret it or
ask for the missing target.

An action must appear as the head of a requested clause. Its direct object
supplies the capability category. Source phrases, purposes, quoted strings,
fenced examples, blockquotes and marked document contents cannot contribute
an unrelated action or software object. Negation and questions apply to their
clause; a subsequent explicit request can introduce another action.

The planner, legacy capability view, messaging selector and desktop selector
share this interpretation. Other specialized selectors retain their own
domain-specific logic; adding a new automatic action should use the shared
parser rather than scanning the entire message for independent verbs/nouns.

When extending routing:

- Add vocabulary to the shared action lexicon and bind the action to its
  relevant object in the caller. Do not add exceptions for individual prompts.
- Test advice, negation, quoted examples, unrelated source nouns, compound
  requests and affirmative requests for the same operation.
- Check `prepareTurn`, not just the classification: a false permission request
  can stop a chat before the model receives it.
- Keep filesystem grants, confirmations, isolation and tool permissions in
  the capability broker. An intent match is never an authorization grant.

`dashboard/tests/hermes-request-language.test.mjs` includes the original
meal-planning regression, combinations of content and software nouns, and
positive controls for coding, file handling, delivery and desktop operations.
