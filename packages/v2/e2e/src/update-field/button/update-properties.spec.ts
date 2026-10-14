/**
 * F20 — button property updates.
 *
 * Requirement IDs: F20 (button holds configuration, not a cell value).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('[D01][S01] F20: button property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldSeq = 0;

  const nextFieldId = () => {
    fieldSeq += 1;
    return `fld${fieldSeq.toString(36).padStart(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'button Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates a single property without resetting the others', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name: 'Run',
        options: { label: 'Run', color: 'blue', maxCount: 5, resetCount: true },
      },
    });

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { label: 'Run now' } },
    });
    const options = fieldOptions(updated.fields.find((f) => f.id === fieldId));
    expect(options.label).toBe('Run now');
    expect(options.color).toBe('blue');
    expect(options.maxCount).toBe(5);
    expect(options.resetCount).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('clears the click budget when the limit is removed', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name: 'Limited',
        options: { label: 'Limited', color: 'red', maxCount: 1 },
      },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { label: 'Limited', color: 'red', maxCount: null } as never },
    });

    const options = fieldOptions(fieldByName(await ctx.getTableById(tableId), 'Limited'));
    expect(options.maxCount ?? null).toBeNull();

    await ctx.deleteField({ tableId, fieldId });
  });

  test('rejects an unknown colour', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name: 'Bad Colour',
        options: { label: 'Bad', color: 'blue' },
      },
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: { options: { label: 'Bad', color: 'chartreuse' } as never },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
  });
});
