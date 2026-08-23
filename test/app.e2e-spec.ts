import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ status: 'ok', service: 'finanzas-back' });
  });

  it('/api/accounts (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/accounts')
      .expect(200)
      .expect([
        {
          id: 'acc_001',
          name: 'Cuenta principal',
          type: 'checking',
          balance: 2450.75,
          currency: 'EUR',
          createdAt: '2026-08-22T10:00:00.000Z',
        },
      ]);
  });

  it('/api/bank-sync (POST)', () => {
    return request(app.getHttpServer())
      .post('/api/bank-sync')
      .send({ provider: 'open-banking' })
      .expect(201)
      .expect((res) => {
        expect(res.body).toMatchObject({
          status: 'queued',
          provider: 'open-banking',
          message: 'Sincronización programada',
        });
      });
  });

  it('/api/transactions/import requires API key when configured (POST)', async () => {
    process.env.BANK_INGEST_API_KEY = 'test-ingest-key';

    await request(app.getHttpServer())
      .post('/api/transactions/import')
      .send({
        source: 'bank',
        transactions: [
          {
            accountId: 'acc_001',
            categoryId: 'cat_003',
            date: '2026-08-21',
            amount: 15,
            description: 'Cafe',
            type: 'expense',
            externalId: 'ext_txn_001',
          },
        ],
      })
      .expect(401);

    delete process.env.BANK_INGEST_API_KEY;
  });

  it('/api/transactions/import skips duplicated externalId (POST)', async () => {
    process.env.BANK_INGEST_API_KEY = 'test-ingest-key';

    const payload = {
      source: 'bank',
      transactions: [
        {
          accountId: 'acc_001',
          categoryId: 'cat_003',
          date: '2026-08-21',
          amount: 15,
          description: 'Cafe',
          type: 'expense',
          externalId: 'ext_txn_001',
        },
      ],
    };

    await request(app.getHttpServer())
      .post('/api/transactions/import')
      .set('x-api-key', 'test-ingest-key')
      .send(payload)
      .expect(201)
      .expect((res) => {
        expect(res.body).toMatchObject({
          imported: 1,
          skipped: 0,
          source: 'bank',
        });
      });

    await request(app.getHttpServer())
      .post('/api/transactions/import')
      .set('x-api-key', 'test-ingest-key')
      .send(payload)
      .expect(201)
      .expect((res) => {
        expect(res.body).toMatchObject({
          imported: 0,
          skipped: 1,
          source: 'bank',
        });
      });

    delete process.env.BANK_INGEST_API_KEY;
  });

  it('/api/sync-history (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/sync-history')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toMatchObject({
          provider: 'open-banking',
          status: expect.stringMatching(/success|queued/),
        });
      });
  });

  it('/api/budget-plan (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/budget-plan')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toMatchObject({
          category: expect.any(String),
          type: expect.stringMatching(/income|expense/),
          planned: expect.any(Number),
          spent: expect.any(Number),
          remaining: expect.any(Number),
        });
      });
  });

  it('/api/budget-alerts (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/budget-alerts')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toMatchObject({
          category: expect.any(String),
          status: expect.stringMatching(/ok|warning|critical/),
          spent: expect.any(Number),
          planned: expect.any(Number),
          remaining: expect.any(Number),
        });
      });
  });

  it('/api/dashboard?month=2026-08&categoryId=cat_001 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/dashboard?month=2026-08&categoryId=cat_001')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          totalIncome: 0,
          totalExpense: 84.5,
          balance: -84.5,
          monthlyTransactions: 1,
        });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
