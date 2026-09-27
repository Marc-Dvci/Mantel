/**
 * Mantel on AWS.
 *
 *   CloudFront ─┬─ /family/*, /tv/*          S3 (the built web apps)
 *               └─ /api/*, /media/*, /ring/*  API Gateway (HTTP API) ─ Lambda "api"
 *   EventBridge, every 5 minutes             Lambda "tick" (door-card expiry, Change Signal, digest)
 *   DynamoDB, one table                      households, events, tokens, Ring receipts
 *   S3                                       photos, recordings, doorbell snapshots
 *   Secrets Manager                          the Ring webhook signing secret and the media key secret
 *   Bedrock, Polly                           drafts and the household voice (IAM only)
 *
 * The API Lambda holds the TV's long-poll for up to 20 seconds, inside API
 * Gateway's 30-second limit.
 */

import { join } from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export interface MantelStackProps extends StackProps {
  repoRoot: string;
  /** Bedrock model id for drafts; drafts are off when empty. */
  modelId?: string;
  bedrockEndpoint?: string;
  pollyVoice?: string;
  /** Deploy the built web apps from dist/ (off in unit tests). */
  deployWeb?: boolean;
  /** Seed the demo household and serve the dev endpoints. */
  demo?: boolean;
}

export class MantelStack extends Stack {
  constructor(scope: Construct, id: string, props: MantelStackProps) {
    super(scope, id, props);

    const table = new Table(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const media = new Bucket(this, "Media", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const web = new Bucket(this, "Web", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const ringSecret = new Secret(this, "RingWebhookSecret", {
      description: "HMAC key Ring signs webhooks with (paste the value from the Ring developer portal)",
    });
    const appSecret = new Secret(this, "AppSecret", {
      description: "Key for household media links",
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const environment: Record<string, string> = {
      MANTEL_STORE: "dynamodb",
      MANTEL_TABLE: table.tableName,
      MANTEL_MEDIA: "s3",
      MANTEL_BUCKET: media.bucketName,
      MANTEL_DEMO: props.demo ? "1" : "0",
      MANTEL_RING_SECRET_ARN: ringSecret.secretArn,
      MANTEL_APP_SECRET_ARN: appSecret.secretArn,
      // Lambda's only writable directory; the demo photos ship inside the bundle.
      MANTEL_DATA_DIR: "/tmp/mantel",
      MANTEL_FIXTURES: "/var/task/fixtures/media",
      NODE_OPTIONS: "--enable-source-maps",
      ...(props.modelId ? { MANTEL_BEDROCK: "1", MANTEL_MODEL_ID: props.modelId } : {}),
      ...(props.bedrockEndpoint ? { MANTEL_BEDROCK_ENDPOINT: props.bedrockEndpoint } : {}),
      ...(props.pollyVoice ? { MANTEL_POLLY: "1", MANTEL_POLLY_VOICE: props.pollyVoice } : {}),
    };

    const entry = join(props.repoRoot, "apps/server/src/lambda.ts");
    const common = {
      entry,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      environment,
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ["module", "main"],
        // ESM bundles still meet CommonJS dependencies that call require().
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        sourceMap: true,
        target: "node22",
        forceDockerBundling: false,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [`node -e "require('fs').cpSync(process.argv[1], process.argv[2], { recursive: true })" "${inputDir}/fixtures/media" "${outputDir}/fixtures/media"`],
        },
      },
      depsLockFilePath: join(props.repoRoot, "pnpm-lock.yaml"),
      projectRoot: props.repoRoot,
    };

    const api = new NodejsFunction(this, "Api", {
      ...common,
      handler: "api",
      memorySize: 512,
      // The TV's long-poll waits up to 20 s; API Gateway allows 30.
      timeout: Duration.seconds(29),
    });
    const tick = new NodejsFunction(this, "Tick", {
      ...common,
      handler: "tick",
      memorySize: 512,
      timeout: Duration.minutes(2),
    });

    for (const fn of [api, tick]) {
      table.grantReadWriteData(fn);
      media.grantReadWrite(fn);
      ringSecret.grantRead(fn);
      appSecret.grantRead(fn);
      if (props.modelId) {
        fn.addToRolePolicy(
          new PolicyStatement({
            actions: ["bedrock:InvokeModel", "bedrock:Converse", "bedrock:CallWithBearerToken"],
            resources: ["*"],
          }),
        );
      }
      if (props.pollyVoice) fn.addToRolePolicy(new PolicyStatement({ actions: ["polly:SynthesizeSpeech"], resources: ["*"] }));
    }

    new Rule(this, "EveryFiveMinutes", {
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [new LambdaFunction(tick)],
    });

    const http = new HttpApi(this, "Http", {
      defaultIntegration: new HttpLambdaIntegration("ApiIntegration", api),
    });
    // The function learns its own address from the API, which depends only on
    // the API resource, not on the integration, so there is no cycle.
    for (const fn of [api, tick]) {
      fn.addEnvironment("MANTEL_PUBLIC_URL", http.apiEndpoint);
      if (props.demo) fn.addEnvironment("RING_API_BASE_URL", `${http.apiEndpoint}/ring-sim`);
    }

    const apiOrigin = new origins.HttpOrigin(`${http.apiId}.execute-api.${this.region}.amazonaws.com`, {
      readTimeout: Duration.seconds(30),
    });
    const passThrough: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };
    const site = new cloudfront.Distribution(this, "Site", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: { "/api/*": passThrough, "/media/*": passThrough, "/ring/*": passThrough, "/ring-sim/*": passThrough },
      defaultRootObject: "family/index.html",
    });

    if (props.deployWeb) {
      new BucketDeployment(this, "WebApps", {
        sources: [Source.asset(join(props.repoRoot, "dist"))],
        destinationBucket: web,
        distribution: site,
        distributionPaths: ["/*"],
      });
    }

    new CfnOutput(this, "Url", { value: `https://${site.distributionDomainName}` });
    new CfnOutput(this, "RingWebhookUrl", { value: `https://${site.distributionDomainName}/ring/webhook` });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "RingSecretArn", { value: ringSecret.secretArn });
  }
}
