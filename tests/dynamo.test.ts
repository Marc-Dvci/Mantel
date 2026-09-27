/**
 * DynamoStore against a real DynamoDB engine.
 *
 *   docker run -d --rm -p 8001:8000 amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory
 *   MANTEL_DYNAMO_ENDPOINT=http://localhost:8001 pnpm test tests/dynamo.test.ts
 *
 * Skipped when no endpoint is set.
 */

import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { demoHousehold } from "../packages/core/src";
import { DynamoStore } from "../apps/server/src/dynamo";
import type { HouseholdState } from "../apps/server/src/store";

const endpoint = process.env.MANTEL_DYNAMO_ENDPOINT;
const table = `mantel-test-${Date.now()}`;

describe.skipIf(!endpoint)("DynamoStore on DynamoDB", () => {
  const client = new DynamoDBClient({ endpoint, region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
  const store = new DynamoStore(table, client);
  const state = (): HouseholdState => ({
    household: demoHousehold(new Date("2026-09-29T18:00:00Z")),
    version: 1,
    alerts: [],
    digests: {},
    evaluated: [],
    tokens: { "tok-a": { kind: "tv", deviceName: "TV" } },
    pairCodes: [],
    presence: { present: false },
    ringDevices: [],
  });

  beforeAll(async () => {
    await client.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
      }),
    );
  });

  afterAll(async () => {
    await client.send(new DeleteTableCommand({ TableName: table }));
  });

  it("round-trips the household and finds its tokens", async () => {
    await store.put("h1", state());
    expect((await store.get("h1"))?.household.person.name).toBe("Margaret");
    expect(await store.households()).toContain("h1");
    expect(await store.findToken("tok-a")).toEqual({ hid: "h1", principal: { kind: "tv", deviceName: "TV" } });
  });

  it("two concurrent writers both land: the version check retries the loser", async () => {
    await Promise.all([
      store.update("h1", (s) => void s.alerts.push({ id: "a1", at: "", kind: "door.unexpected", urgency: "attention", title: "one", body: "" })),
      store.update("h1", (s) => void s.alerts.push({ id: "a2", at: "", kind: "door.unexpected", urgency: "attention", title: "two", body: "" })),
    ]);
    const s = await store.get("h1");
    expect(s?.alerts.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
    expect(s?.version).toBe(3);
  });

  it("stores events and reads them back by time range", async () => {
    await store.addEvents(
      "h1",
      Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, at: new Date(Date.UTC(2026, 8, 29, 12, i)).toISOString(), type: "question" as const })),
    );
    const some = await store.events("h1", "2026-09-29T12:10:00.000Z", "2026-09-29T12:20:00.000Z");
    expect(some.map((e) => e.id)).toEqual(Array.from({ length: 10 }, (_, i) => `e${i + 10}`));
    expect(await store.deleteEvents("h1")).toBe(60);
    expect(await store.events("h1", "0000", "9999")).toHaveLength(0);
  });

  it("records a Ring request id once", async () => {
    expect(await store.recordReceipt("ring:abc")).toBe(true);
    expect(await store.recordReceipt("ring:abc")).toBe(false);
  });

  it("wakes a waiting reader when the version moves", async () => {
    const v = (await store.get("h1"))!.version;
    const waiting = store.waitForVersion("h1", v, 8000);
    setTimeout(() => void store.update("h1", () => undefined), 500);
    expect(await waiting).toBe(v + 1);
  });
});
