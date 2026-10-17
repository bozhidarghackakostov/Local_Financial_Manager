import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Express } from 'express';
import { createApp, type ServicesContainer } from '../../src/server/app.js';

describe('Local HTTP API & Security Endpoints', () => {
  let tmpDir: string;
  let app: Express;
  let services: ServicesContainer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerdesk-api-'));
    const created = createApp({
      dbPath: path.join(tmpDir, 'api.sqlite'),
      backupsDir: path.join(tmpDir, 'backups'),
    });
    app = created.app;
    services = created.services;
  });

  afterEach(() => {
    services.dbManager.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns health status and sets strict Content-Security-Policy headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('blocks state-changing requests coming from external browser origins', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .set('Origin', 'https://evil-tracker.example.com')
      .send({
        name: 'CSRFAttempt',
        account_type: 'cash',
        opening_balance_minor: 0,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('supports full account, transaction, budget, recurring, goal, and report lifecycle over HTTP', async () => {
    // 1. Create account
    const accRes = await request(app)
      .post('/api/accounts')
      .set('Origin', 'http://127.0.0.1:5173')
      .send({
        name: 'Primary Checking',
        account_type: 'current',
        opening_balance_minor: 100000,
        description: 'Everyday account',
      });
    expect(accRes.status).toBe(201);
    const accountId = accRes.body.data.id;

    // 2. Create transaction
    const txRes = await request(app).post('/api/transactions').send({
      transaction_type: 'expense',
      transaction_date: '2026-10-15',
      amount_minor: 12500,
      account_id: accountId,
      category_id: 'cat-exp-groceries',
      description: 'Weekly groceries',
      tags: ['food', 'essentials'],
    });
    expect(txRes.status).toBe(201);
    expect(txRes.body.data.tags).toEqual(['food', 'essentials']);

    // 3. Verify account deletion protection when transactions exist
    const delAccRes = await request(app).delete(`/api/accounts/${accountId}`);
    expect(delAccRes.status).toBe(409);

    // 4. Create budget and check utilization
    const bdgRes = await request(app).post('/api/budgets').send({
      name: 'Groceries Budget',
      category_id: 'cat-exp-groceries',
      period_month: '2026-10',
      planned_amount_minor: 50000,
    });
    expect(bdgRes.status).toBe(201);
    expect(bdgRes.body.data.actual_minor).toBe(12500);
    expect(bdgRes.body.data.remaining_minor).toBe(37500);
    expect(bdgRes.body.data.percentage_used).toBe(25);

    // 5. Create savings goal and record contribution
    const goalRes = await request(app).post('/api/goals').send({
      name: 'Holiday Fund',
      target_amount_minor: 200000,
      target_date: '2027-06-01',
    });
    expect(goalRes.status).toBe(201);
    const goalId = goalRes.body.data.id;

    const contribRes = await request(app).post(`/api/goals/${goalId}/contributions`).send({
      amount_minor: 50000,
      contribution_date: '2026-10-16',
      notes: 'October deposit',
    });
    expect(contribRes.status).toBe(201);
    expect(contribRes.body.data.goal.current_amount_minor).toBe(50000);
    expect(contribRes.body.data.goal.percentage_achieved).toBe(25);

    // 6. Export transactions CSV and Full JSON
    const csvExport = await request(app).get('/api/export/transactions.csv');
    expect(csvExport.status).toBe(200);
    expect(csvExport.text).toContain('Weekly groceries');
    expect(csvExport.text).toContain('125.00');

    const jsonExport = await request(app).get('/api/export/full.json');
    expect(jsonExport.status).toBe(200);
    const parsedJson = JSON.parse(jsonExport.text);
    expect(parsedJson.application).toBe('LedgerDesk');
    expect(parsedJson.data.accounts.length).toBe(1);
    expect(parsedJson.data.transactions.length).toBe(1);
  });
});
