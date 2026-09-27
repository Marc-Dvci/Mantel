import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { MantelStack } from "../infrastructure/cdk/stack";

describe("CDK stack", () => {
  const app = new App({ outdir: mkdtempSync(join(tmpdir(), "mantel-cdk-")) });
  const stack = new MantelStack(app, "Test", {
    repoRoot: resolve(__dirname, ".."),
    modelId: "openai.gpt-oss-120b",
    pollyVoice: "Joanna",
    demo: true,
    env: { region: "us-east-1", account: "123456789012" },
  });
  const t = Template.fromStack(stack);

  it("one table keyed pk/sk with a TTL for Ring receipts", () => {
    t.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("media and web buckets are private", () => {
    t.resourcePropertiesCountIs(
      "AWS::S3::Bucket",
      { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } },
      2,
    );
  });

  it("the API function outlives the TV's 20-second long-poll", () => {
    t.hasResourceProperties("AWS::Lambda::Function", { Handler: "index.api", Timeout: 29, Runtime: "nodejs22.x" });
  });

  it("ticks every five minutes", () => {
    t.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(5 minutes)" });
  });

  it("can call Bedrock and Polly, and read its two secrets", () => {
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: "polly:SynthesizeSpeech" })]) },
    });
    t.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(["bedrock:InvokeModel"]) })]) },
    });
    t.resourceCountIs("AWS::SecretsManager::Secret", 2);
  });

  it("routes the API, media and Ring paths through CloudFront to API Gateway", () => {
    const dist = Object.values(t.findResources("AWS::CloudFront::Distribution"))[0] as { Properties: { DistributionConfig: { CacheBehaviors: { PathPattern: string }[] } } };
    expect(dist.Properties.DistributionConfig.CacheBehaviors.map((b) => b.PathPattern).sort()).toEqual(["/api/*", "/media/*", "/ring-sim/*", "/ring/*"]);
  });
});
