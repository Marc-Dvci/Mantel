# Safety, dignity and privacy

Mantel speaks to a person who may not remember what it said a minute ago and who may believe what a screen tells them. These are the rules the code keeps.

## The words

- **Every word on the TV comes from the family or from their plan.** A family topic's answer is written by a member. A built-in topic answers from the plan and the clock ("Sarah is coming today at 4 o'clock"), and its fallback when the plan has nothing is written by the family. `Matcher` only ever considers approved topics.
- **Nothing reaches the TV until the primary caregiver approves it.** Topics, photos and messages from other members wait in Sarah's approval queue. Changing an answer's words drops its old recording, because a recording of the old words is no longer a recording of this answer.
- **Names gate answers.** A question that names a person can only be answered by a topic about that person; a question that names nobody can never be answered by a topic about somebody; a question with "he" or "she" and no name gets no answer. Across both held-out question sets, no question was answered with another topic's answer ([EVAL.md](EVAL.md)).
- **Unknown is safe.** A question Mantel has no answer for gets "Let's look at today together." and the Today screen, and it goes to the family, who can add an answer.
- **Answers carry their date.** Every answer shows who wrote it and when ("Sarah, on Thursday"). An answer can expire, after which the TV says the family's neutral fallback and not the stale words.

## The hard questions

"Where is Robert?", about a husband who died, is the question families find hardest. The family chooses, topic by topic, whether the TV **tells**, **redirects** or **comforts**, and writes the words. The family app offers starting points for four of these questions, each with the three policies and a link to published caregiving guidance (`GUIDANCE` in `packages/core/src/topics.ts`). Mantel never picks the policy.

A person-specific redirect or comfort topic also catches any question about that person that the matcher cannot place ("Where did Robert go?"), because that topic is the family's answer to any question about them. A "tell" topic always needs matching words.

## Medication

The pills topic confirms only what someone marked done in the plan: "Yes. You took your pills at 9:14 with Anna." When nothing is marked it says the family's fallback ("Your pills are looked after. Anna helps you with them."). It never says pills were missed and never tells the person to take anything, because a person who does not remember taking them could take them twice.

## The door

The door card uses only what the family planned. It never identifies a caller and never calls a caller dangerous. With nothing planned it says the person does not need to open the door and that their caregiver can see who it is; the caregiver gets the snapshot and the Ring app does the rest.

## The Change Signal

The alert names what changed, against the person's own recent days, and suggests a call: "A sudden change can have a medical cause, such as an infection. Consider calling Margaret's doctor." It never names a condition. Days the family marks unusual (a hospital stay, a family holiday) are left out of baselines and alerts.

The digest is a template over counts. No model writes it, because a caregiver uses it to decide whether to call a doctor ([MODEL.md](MODEL.md)).

## What the TV sees and hears

| Stays on the TV | Leaves the TV |
|---|---|
| camera frames | presence start and end, with the time |
| microphone audio | a question's recognised words and which answer was shown |
| speech that was not a question for Mantel | which photo, story or message was played |

The camera-on indicator sits in the corner of the screen whenever presence sensing runs. The listening mode is the family's choice: questions, only after "Mantel", or off. The family app's Privacy card shows what is stored and lets the primary caregiver erase every stored event.

## Consent

Set Mantel up with the person while they can take part: show them the camera indicator, the listening modes and the family app. Care mode, which reopens Mantel, is a checkbox the family can clear.

## Scope

Mantel is a family communication and routine tool. It is not a medical device and makes no clinical claim.
