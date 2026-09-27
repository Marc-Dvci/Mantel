/**
 * DynamoDB storage, one table.
 *
 *   pk = HH#<hid>      sk = STATE              the household document, with `version`
 *   pk = EV#<hid>      sk = <iso>#<event id>   one item per event
 *   pk = TOKEN#<t>     sk = TOKEN              token lookup
 *   pk = RCPT#<key>    sk = RCPT               Ring request ids, expire after 2 days
 *
 * The state write is conditional on the version it read, so two writers (a
 * Ring webhook and a family edit at the same moment) cannot lose each other's
 * change; the loser re-reads and re-applies.
 */

import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { MantelEvent } from "../../../packages/core/src";
import { trim, type HouseholdState, type Principal, type Store } from "./store";

export class DynamoStore implements Store {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async households() {
    const out = await this.doc.send(
      new ScanCommand({ TableName: this.table, FilterExpression: "sk = :s", ExpressionAttributeValues: { ":s": "STATE" }, ProjectionExpression: "pk" }),
    );
    return (out.Items ?? []).map((i) => String(i.pk).slice(3));
  }

  async get(hid: string) {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: `HH#${hid}`, sk: "STATE" }, ConsistentRead: true }));
    return out.Item ? (JSON.parse(String(out.Item.doc)) as HouseholdState) : undefined;
  }

  async put(hid: string, state: HouseholdState) {
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: { pk: `HH#${hid}`, sk: "STATE", version: state.version, doc: JSON.stringify(trim(state)) } }),
    );
    for (const [token, principal] of Object.entries(state.tokens)) await this.saveTokenItem(hid, token, principal);
  }

  async update<T>(hid: string, fn: (s: HouseholdState) => T) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.get(hid);
      if (!current) throw new Error(`No household ${hid}`);
      const before = current.version;
      const result = fn(current);
      current.version = before + 1;
      try {
        await this.doc.send(
          new PutCommand({
            TableName: this.table,
            Item: { pk: `HH#${hid}`, sk: "STATE", version: current.version, doc: JSON.stringify(trim(current)) },
            ConditionExpression: "version = :v",
            ExpressionAttributeValues: { ":v": before },
          }),
        );
        return { state: current, result };
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) continue;
        throw err;
      }
    }
    throw new Error(`Could not update ${hid}: too many concurrent writers`);
  }

  async addEvents(hid: string, events: MantelEvent[]) {
    for (let i = 0; i < events.length; i += 25) {
      const chunk = events.slice(i, i + 25);
      await this.doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.table]: chunk.map((e) => ({ PutRequest: { Item: { pk: `EV#${hid}`, sk: `${e.at}#${e.id}`, event: JSON.stringify(e) } } })),
          },
        }),
      );
    }
  }

  async events(hid: string, fromIso: string, toIso: string) {
    const out: MantelEvent[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :p AND sk BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":p": `EV#${hid}`, ":a": fromIso, ":b": `${toIso}` },
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      for (const i of page.Items ?? []) out.push(JSON.parse(String(i.event)) as MantelEvent);
      start = page.LastEvaluatedKey;
    } while (start);
    return out.filter((e) => e.at >= fromIso && e.at < toIso);
  }

  async deleteEvents(hid: string) {
    const all = await this.events(hid, "0000", "9999");
    for (let i = 0; i < all.length; i += 25) {
      await this.doc.send(
        new BatchWriteCommand({
          RequestItems: { [this.table]: all.slice(i, i + 25).map((e) => ({ DeleteRequest: { Key: { pk: `EV#${hid}`, sk: `${e.at}#${e.id}` } } })) },
        }),
      );
    }
    return all.length;
  }

  async recordReceipt(key: string) {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `RCPT#${key}`, sk: "RCPT", expiresAt: Math.floor(Date.now() / 1000) + 2 * 86400 },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async findToken(token: string) {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: `TOKEN#${token}`, sk: "TOKEN" } }));
    return out.Item ? { hid: String(out.Item.hid), principal: JSON.parse(String(out.Item.principal)) as Principal } : undefined;
  }

  async saveToken(hid: string, token: string, principal: Principal) {
    await this.saveTokenItem(hid, token, principal);
    await this.update(hid, (s) => {
      s.tokens[token] = principal;
    });
  }

  private async saveTokenItem(hid: string, token: string, principal: Principal) {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { pk: `TOKEN#${token}`, sk: "TOKEN", hid, principal: JSON.stringify(principal) } }));
  }

  async waitForVersion(hid: string, since: number, ms: number) {
    const deadline = Date.now() + ms;
    for (;;) {
      const out = await this.doc.send(
        new GetCommand({ TableName: this.table, Key: { pk: `HH#${hid}`, sk: "STATE" }, ProjectionExpression: "version", ConsistentRead: true }),
      );
      const v = Number(out.Item?.version ?? 0);
      if (v > since || Date.now() >= deadline) return v;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
