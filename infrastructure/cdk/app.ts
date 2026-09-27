/**
 * Synthesises the Mantel stack.
 *
 *   pnpm cdk:synth                         CloudFormation into infrastructure/cdk/cdk.out
 *   npx cdk deploy --app "npx tsx infrastructure/cdk/app.ts"
 *
 * Context (or environment): MANTEL_MODEL_ID, MANTEL_BEDROCK_ENDPOINT,
 * MANTEL_POLLY_VOICE, MANTEL_DEMO=1.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import { MantelStack } from "./stack";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const app = new App({ outdir: process.env.CDK_OUTDIR ?? join(here, "cdk.out") });

new MantelStack(app, "Mantel", {
  repoRoot,
  ...(process.env.MANTEL_MODEL_ID ? { modelId: process.env.MANTEL_MODEL_ID } : { modelId: "openai.gpt-oss-120b" }),
  bedrockEndpoint: process.env.MANTEL_BEDROCK_ENDPOINT ?? "https://bedrock-mantle.us-east-1.api.aws",
  pollyVoice: process.env.MANTEL_POLLY_VOICE ?? "Joanna",
  deployWeb: true,
  demo: process.env.MANTEL_DEMO === "1",
  env: { region: process.env.AWS_REGION ?? "us-east-1", ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}) },
  description: "Mantel: a Fire TV app that answers a person living with dementia in their family's words",
});

app.synth();
