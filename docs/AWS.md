# AWS

## Services and what each does

| Service | Used for | Code |
|---|---|---|
| **Amazon Bedrock** | drafts for the family: photo captions and calmer wordings of answers, checked before they are shown | `apps/server/src/language.ts` |
| **Amazon Polly** | the household voice for answers the family wrote but did not record, synthesised once per line and cached in media storage | `language.ts`, `service.ts` (`speech`) |
| **AWS Lambda** | the API (Express through `serverless-http`) and the scheduled tick | `apps/server/src/lambda.ts` |
| **Amazon API Gateway** (HTTP API) | the API's front door; 30-second limit covers the TV's 20-second long-poll | `infrastructure/cdk/stack.ts` |
| **Amazon DynamoDB** | one table: household documents (version-checked writes), events, tokens, Ring receipts with a TTL | `apps/server/src/dynamo.ts` |
| **Amazon S3** | photos, recordings, doorbell snapshots (private); the built web apps | `apps/server/src/media.ts` |
| **Amazon CloudFront** | one address for the web apps and the API | `stack.ts` |
| **Amazon EventBridge** | the tick every five minutes: door-card expiry, the Change Signal, the digest | `stack.ts` |
| **AWS Secrets Manager** | the Ring webhook signing secret and the media-link secret, read at cold start | `lambda.ts` |
| **AWS CDK** | the whole stack as code, with assertion tests | `infrastructure/cdk`, `tests/cdk.test.ts` |

## Bedrock transport

The server reaches Bedrock two ways, chosen by configuration:

- the Bedrock API endpoint (`MANTEL_BEDROCK_ENDPOINT=https://bedrock-mantle.us-east-1.api.aws`), OpenAI-compatible chat completions with a short-term bearer token minted from the caller's AWS credentials by `@aws/bedrock-token-generator`;
- the runtime SDK's `Converse` when no endpoint is set.

The default model is `openai.gpt-oss-120b`, asked for low reasoning effort.

## Runs against AWS

`pnpm check` exercises each switched-on integration with a real call:

```
Bedrock   caption (openai.gpt-oss-120b, 1278 ms, model): drafted from people, place and year
Bedrock   answer  (1289 ms, model): a calmer wording of a family answer, kept to its policy
Polly     polly-neural-Joanna: 13580 bytes of MP3 in 410 ms
```

The DynamoDB store was run against DynamoDB's own engine (DynamoDB Local): `tests/dynamo.test.ts`, 5 tests, including two concurrent writers that both land through the version check and a long-poll woken by a version change. The Lambda bundle that `cdk synth` produces was loaded and invoked with API Gateway v2 events against that engine: it seeded the demo household (40 days of events through `BatchWriteItem`), served the TV state and the family overview, refused a media link with the wrong key, and ran the tick.

## Deploy

```bash
pnpm build:web
MANTEL_DEMO=1 npx cdk deploy --app "npx tsx infrastructure/cdk/app.ts"
# then paste the Ring webhook signing secret into the RingWebhookSecret secret, and the RingWebhookUrl output into the Ring developer portal
```

Configuration comes from the environment: `MANTEL_MODEL_ID`, `MANTEL_BEDROCK_ENDPOINT`, `MANTEL_POLLY_VOICE`, `MANTEL_DEMO`.

## Environment variables (server)

| Variable | Meaning |
|---|---|
| `MANTEL_STORE=dynamodb`, `MANTEL_TABLE` | DynamoDB store (default: files under `.state/`) |
| `MANTEL_MEDIA=s3`, `MANTEL_BUCKET` | S3 media (default: files) |
| `MANTEL_BEDROCK=1`, `MANTEL_BEDROCK_ENDPOINT`, `MANTEL_MODEL_ID` | drafts |
| `MANTEL_POLLY=1`, `MANTEL_POLLY_VOICE`, `MANTEL_POLLY_ENGINE`, `MANTEL_POLLY_PROFILE` | household voice; the profile lets Polly use its own credentials |
| `RING_ACCESS_TOKEN`, `RING_API_BASE_URL`, `RING_WEBHOOK_SECRET`, `RING_OUTSIDE_DOORS` | the live Ring API (default: the built-in simulator) |
| `MANTEL_DEMO=0` | no demo household, no dev endpoints |
