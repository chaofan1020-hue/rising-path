import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, parseSpreadsheet } from '../src/lib/spreadsheet-parser';

const rows = parseCsv('name,description\nAlice,"line one,\nline two"\nBob,"say ""hello"""');
assert.deepEqual(rows, [
  ['name', 'description'],
  ['Alice', 'line one,\nline two'],
  ['Bob', 'say "hello"'],
]);

assert.deepEqual(parseCsv('\uFEFFa,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
assert.throws(() => parseCsv('a,"unterminated'), /引号未闭合/);

void (async () => {
  const template = new File(
    [readFileSync('public/岗位导入模板.xlsx')],
    '岗位导入模板.xlsx',
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  const templateRows = await parseSpreadsheet(template.name, template);
  assert.ok(templateRows.length >= 1);
  assert.ok(templateRows[0].length <= 100);
  console.log('spreadsheet parser checks passed');
})();
