import { expect, test } from '@playwright/test';

test('passes', () => {
    expect(2 + 2).toBe(4);
});

test('fails', () => {
    console.log('failure diagnostic fixture output');
    expect('actual', 'Reporter fixture intentional failure').toBe('expected');
});

// oxlint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
test('recovers on retry', ({}, testInfo) => {
    expect(
        testInfo.retry,
        'Reporter fixture intentional first-attempt failure',
    ).toBeGreaterThan(0);
});

test.skip('skips', () => {});

test('expected failure', () => {
    test.fail();
    expect(false).toBe(true);
});

test('unexpected pass', () => {
    test.fail();
    expect(true).toBe(true);
});

test('times out', async () => {
    test.setTimeout(100);
    await new Promise(() => {});
});

test('captures stdout', () => {
    console.log('worker output retained by JSON reporter');
    console.error('\u001b[31mworker stderr retained by JSON reporter\u001b[0m');
    expect(true).toBe(true);
});
