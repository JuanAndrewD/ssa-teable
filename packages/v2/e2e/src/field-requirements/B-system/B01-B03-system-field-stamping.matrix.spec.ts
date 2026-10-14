/**
 * B01 / B02 / B03 — system field stamping and tracking.
 *
 * B01 (建议需求): created time/by are stamped once at creation and survive later
 * edits, including an explicit write attempt through the API.
 * B02 (实现依据): `lastModifiedTime`/`lastModifiedBy` accept `trackedFieldIds`
 * and must only advance for the tracked fields.
 * B03 (待定口径): the requirement document asks whether a no-op edit or a
 * config-only change counts as a modification. Both are characterised below.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  fieldByName,
  findRow,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

const TEST_USER_ID = 'usrTestUserId';

describe('B01/B02/B03: system field stamping and tracking', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  const ids: Record<string, string> = {};

  const readRow = async (recordId: string) => {
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const row = findRow(rows, recordId);
    if (!row) throw new Error(`row ${recordId} not found`);
    return row;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B01 System Fields',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Tracked' },
        { type: 'singleLineText', name: 'Untracked' },
        { type: 'createdTime', name: 'CreatedTime' },
        { type: 'createdBy', name: 'CreatedBy' },
        { type: 'lastModifiedTime', name: 'ModifiedTimeAll' },
        { type: 'lastModifiedBy', name: 'ModifiedByAll' },
        { type: 'lastModifiedTime', name: 'ModifiedTimeTracked' },
        { type: 'lastModifiedBy', name: 'ModifiedByTracked' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;

    // `trackedFieldIds` needs the tracked column id, so it is wired after the
    // table exists.
    const trackedId = fieldByName(table, 'Tracked').id;
    for (const name of ['ModifiedTimeTracked', 'ModifiedByTracked']) {
      await ctx.updateField({
        tableId,
        fieldId: fieldByName(table, name).id,
        field: { options: { trackedFieldIds: [trackedId] } },
      });
    }

    const fresh = await ctx.getTableById(tableId);
    for (const field of fresh.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('B01 created time/by are stamped at creation', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Title]: 'row' });
    const row = await readRow(record.id);

    expect(typeof row.fields[ids.CreatedTime]).toBe('string');
    expect(Number.isNaN(Date.parse(row.fields[ids.CreatedTime] as string))).toBe(false);
    expect(row.fields[ids.CreatedBy]).toMatchObject({ id: TEST_USER_ID });
  });

  test('B01 a payload of only system fields succeeds without changing values', async () => {
    const record = await ctx.createRecord(tableId, {});
    const before = await readRow(record.id);

    // System-only assignments are silently ignored, including modification stamps.
    const updated = await ctx.updateRecord(tableId, record.id, {
      [ids.CreatedTime]: '2000-01-01T00:00:00.000Z',
      [ids.CreatedBy]: 'usrSomeoneElse',
    });
    for (const [fieldId, value] of Object.entries(before.fields)) {
      expect(updated.fields[fieldId] ?? null).toEqual(value ?? null);
    }

    const after = await readRow(record.id);
    expect(after.fields[ids.CreatedTime]).toBe(before.fields[ids.CreatedTime]);
    expect(after.fields[ids.CreatedBy]).toEqual(before.fields[ids.CreatedBy]);
    expect(after.fields).toEqual(before.fields);
  });

  test('B01 system fields mixed into a normal write are ignored', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Title]: 'original' });
    const before = await readRow(record.id);

    const updated = await ctx.updateRecord(tableId, record.id, {
      [ids.Title]: 'changed',
      [ids.CreatedTime]: '2000-01-01T00:00:00.000Z',
      [ids.CreatedBy]: 'usrSomeoneElse',
      [ids.ModifiedTimeAll]: '2000-01-01T00:00:00.000Z',
    });
    expect(updated.fields[ids.Title]).toBe('changed');

    const after = await readRow(record.id);
    expect(after.fields[ids.CreatedTime]).toBe(before.fields[ids.CreatedTime]);
    expect(after.fields[ids.CreatedBy]).toEqual(before.fields[ids.CreatedBy]);
    expect(after.fields[ids.ModifiedTimeAll]).not.toBe('2000-01-01T00:00:00.000Z');
  });

  test('B01 the create payload cannot pre-seed created time/by', async () => {
    const record = await ctx.createRecord(tableId, {
      [ids.CreatedTime]: '2000-01-01T00:00:00.000Z',
      [ids.CreatedBy]: 'usrSomeoneElse',
    });
    const row = await readRow(record.id);

    expect(row.fields[ids.CreatedTime]).not.toBe('2000-01-01T00:00:00.000Z');
    expect(row.fields[ids.CreatedBy]).toMatchObject({ id: TEST_USER_ID });
  });

  test('B02 an edit to a tracked field advances the tracked stamps', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: 'b' });
    const after = await readRow(record.id);

    expect(Date.parse(after.fields[ids.ModifiedTimeTracked] as string)).toBeGreaterThan(
      Date.parse(before.fields[ids.ModifiedTimeTracked] as string)
    );
    expect(after.fields[ids.ModifiedByTracked]).toMatchObject({ id: TEST_USER_ID });
  });

  /**
   * B02 — tracked fields only advance the stamp for the configured list.
   *
   * The stored form of a LastModifiedTime/LastModifiedBy column is decided by
   * `trackedFieldIds`: an empty list means "track all" and is persisted as a
   * GENERATED column, a non-empty list is written by the mutation path. Editing
   * the tracking list therefore has to migrate the physical column, which is
   * what these cases guard.
   */
  test('B02 an edit to an untracked field leaves the tracked stamps alone', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Untracked]: 'y' });
    const after = await readRow(record.id);

    expect(after.fields[ids.ModifiedTimeTracked]).toBe(before.fields[ids.ModifiedTimeTracked]);
    expect(after.fields[ids.ModifiedByTracked]).toEqual(before.fields[ids.ModifiedByTracked]);
    // The tracking-free stamps still moved.
    expect(Date.parse(after.fields[ids.ModifiedTimeAll] as string)).toBeGreaterThan(
      Date.parse(before.fields[ids.ModifiedTimeAll] as string)
    );
  });

  test('B02 updating a field created with trackedFieldIds only follows the tracked list', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'lastModifiedTime',
        name: 'ModifiedTimeInline',
        options: { trackedFieldIds: [ids.Tracked] },
      },
    });
    const fieldId = fieldByName(created, 'ModifiedTimeInline').id;

    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);
    expect(before.fields[fieldId]).toBeTruthy();

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Untracked]: 'y' });
    expect((await readRow(record.id)).fields[fieldId]).toBe(before.fields[fieldId]);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: 'b' });
    expect(Date.parse((await readRow(record.id)).fields[fieldId] as string)).toBeGreaterThan(
      Date.parse(before.fields[fieldId] as string)
    );
  });

  test('B02 widening the tracking list back to track-all resumes stamping every edit', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'lastModifiedTime',
        name: 'ModifiedTimeWiden',
        options: { trackedFieldIds: [ids.Tracked] },
      },
    });
    const fieldId = fieldByName(created, 'ModifiedTimeWiden').id;

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { trackedFieldIds: [] } },
    });
    const reloaded = await ctx.getTableById(tableId);
    // An empty list is the default "track all", so the option is normalised away.
    const tracked = (
      fieldByName(reloaded, 'ModifiedTimeWiden').options as {
        trackedFieldIds?: string[];
      }
    ).trackedFieldIds;
    expect(tracked ?? []).toEqual([]);

    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Untracked]: 'y' });
    expect((await readRow(record.id)).fields[fieldId]).not.toBe(before.fields[fieldId]);
  });

  test('B02 the persisted trackedFieldIds configuration is round-tripped', async () => {
    const table = await ctx.getTableById(tableId);
    for (const name of ['ModifiedTimeTracked', 'ModifiedByTracked']) {
      const options = fieldByName(table, name).options as { trackedFieldIds?: string[] };
      expect(options.trackedFieldIds).toEqual([ids.Tracked]);
    }
  });

  test('B03 an edit that changes no value does not advance the modification time', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'same', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: 'same', [ids.Untracked]: 'x' });
    const after = await readRow(record.id);

    expect(after.fields[ids.ModifiedTimeAll]).toBe(before.fields[ids.ModifiedTimeAll]);
    expect(after.fields[ids.ModifiedTimeTracked]).toBe(before.fields[ids.ModifiedTimeTracked]);
  });

  test('B03 a field rename does not advance record modification stamps', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'x' });
    const before = await readRow(record.id);

    await ctx.updateField({
      tableId,
      fieldId: ids.Tracked,
      field: { name: 'Tracked renamed' },
    });

    const after = await readRow(record.id);
    expect(after.fields[ids.ModifiedTimeAll]).toBe(before.fields[ids.ModifiedTimeAll]);
  });

  test('B02 clearing a tracked value counts as a modification of that field', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'to-clear' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: null });
    const after = await readRow(record.id);

    expect(Date.parse(after.fields[ids.ModifiedTimeTracked] as string)).toBeGreaterThan(
      Date.parse(before.fields[ids.ModifiedTimeTracked] as string)
    );
    await expect(readValue(ctx, tableId, record.id, ids.Tracked)).resolves.toBeNull();
  });

  describe('B01 a later edit never re-stamps created fields', () => {
    it('stays put across repeated edits', async () => {
      const record = await ctx.createRecord(tableId, {});
      const created = await readRow(record.id);

      for (const value of ['a', 'b', 'c']) {
        await settle();
        await ctx.updateRecord(tableId, record.id, { [ids.Title]: value });
      }

      const after = await readRow(record.id);
      expect(after.fields[ids.CreatedTime]).toBe(created.fields[ids.CreatedTime]);
      expect(after.fields[ids.CreatedBy]).toEqual(created.fields[ids.CreatedBy]);
    });
  });
});
