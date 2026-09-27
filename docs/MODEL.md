# Where a model is used, and where it is not

| Place | Model | Why |
|---|---|---|
| Matching a spoken question to a topic | none | deterministic IDF-weighted matching with name gates; a wrong answer to a person with dementia is worse than no answer, and the rules make every refusal explainable |
| The words the TV says | none | written or approved by the family, or computed from the plan and the clock |
| Speech recognition on the TV | Vosk small English (on the device) | audio never leaves the house |
| Presence | `android.media.FaceDetector` (on the device) | frames never leave the house |
| Photo captions in the family app | Amazon Bedrock (`openai.gpt-oss-120b`) | a draft from the facts typed (who, where, year) for the family to edit |
| A calmer wording of an answer | Amazon Bedrock | a draft of what the family wrote, kept to their policy, for them to use or not |
| The household voice | Amazon Polly (neural) | one consistent voice for answers the family wrote but did not record |
| The evening digest | none | see below |

## The draft checks

Every Bedrock draft passes `checkDraft` (`packages/core/src/checks.ts`) before the family sees it: no name the inputs did not contain, no number the inputs did not contain, no death words unless the family used them, a length and sentence limit. A failed draft is replaced by the family's own words or the plain template, and the app says which one the family is reading. Drafts never reach the TV on their own: the family uses one or not.

Measured on the live endpoint (`pnpm check`): a caption drafted in 1.3 to 2.3 seconds, an answer rewording in 1.3 to 4.1 seconds.

## Why the digest is not written by a model

The digest's first version had a model write its prose from the day's counts, with the same checks. Run against the live endpoint, the model's versions replaced the counts with "many" and "several" and added readings no count supports: "the evening was spent quietly", "the night period was long". The checks look for new names and new numbers, and these drafts had none. A caregiver reads the digest to decide whether to call a doctor, so every sentence in it must be one they can check. The digest is now a template over the counts (`digestProse`), and a test asserts it carries the question count and none of those words.

## Reasoning models and token budgets

`openai.gpt-oss-120b` is a reasoning model. With a 700-token budget it returned an empty answer: the reasoning used the budget. The client now asks for low reasoning effort and allows 2,500 tokens.
