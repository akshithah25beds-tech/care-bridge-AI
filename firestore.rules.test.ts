import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('Dirty Dozen security assertions exist in Firestore rules', () => {
  assert.match(rulesContent, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /function isValidId\(id\)/);
  assert.match(rulesContent, /function isValidPatientCase\(data\)/);
  assert.match(rulesContent, /incoming\(\)\.ownerId == request\.auth\.uid/);
  assert.match(rulesContent, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly/);
  assert.match(rulesContent, /existing\(\)\.stage != 'closed'/);
  assert.match(rulesContent, /existing\(\)\.consentGranted == true/);
  assert.match(rulesContent, /existing\(\)\.resultAcknowledged == true/);
  assert.match(rulesContent, /match \/auditLogs\/\{logId\}[\s\S]*allow update, delete: if false;/);
  assert.match(rulesContent, /match \/private\/info/);
});

test('Allow list rules do not use get() or exists() lookups', () => {
  const listLines = rulesContent.split('\n').filter((line) => line.includes('allow list:'));
  assert.ok(listLines.length >= 6);
  for (const line of listLines) {
    assert.equal(line.includes('get('), false, `allow list must not call get(): ${line}`);
    assert.equal(line.includes('exists('), false, `allow list must not call exists(): ${line}`);
  }
});

test('Read and delete rules never reference incoming() or request.resource', () => {
  const lines = rulesContent.split('\n');
  for (const line of lines) {
    if (line.includes('allow read:') || line.includes('allow get:') || line.includes('allow list:') || line.includes('allow delete:')) {
      assert.equal(line.includes('incoming('), false, `read/delete must not call incoming(): ${line}`);
      assert.equal(line.includes('request.resource'), false, `read/delete must not use request.resource: ${line}`);
    }
  }
});
